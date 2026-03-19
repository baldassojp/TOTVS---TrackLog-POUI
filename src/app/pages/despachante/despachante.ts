import { Component, OnInit, OnDestroy, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import {
  PoModule,
  PoTableColumn,
  PoSelectOption,
  PoNotificationService,
  PoModalComponent,
  PoModalAction,
} from '@po-ui/ng-components';
import { Subject } from 'rxjs';
import { forkJoin, takeUntil, finalize } from 'rxjs';
import { TracklogService, PayloadSalvarRota } from '../../services/tracklog.service';
import { environment } from '../../../environments/environment';

// ======== INTERFACES =======

interface Pedido {
  numero: string;
  nomeCliente: string;
  endereco: string;
  cidade: string;
  volumes: number;
  $selected?: boolean;
}

interface PedidoSelecionado extends Pedido {
  seq: number;
}

interface ItemRota {
  seq: number;
  numero: string;
  nomeCliente: string;
  endereco: string;
  cidade: string;
  volumes: number;
  distanciaKm: number;
  tempoMin: number;
  motivo: string;
}

interface ResumoRota {
  distancia: string;
  tempo: string;
  litros: string;
  custo: string;
  veiculo: string;
  combustivel: string;
}

interface ConfigVeiculo {
  nome: string;
  consumo: number;
  combustivel: string;
  precoCombustivel: number;
  capacidade: number;
}

interface RespostaGroq {
  rota: Array<{
    seq: number;
    numero: string;
    distanciaKm: number;
    tempoMin: number;
    motivo: string;
  }>;
  totalKm: number;
  totalMin: number;
  observacoes: string;
}

interface PontomMapa {
  label: string;
  endereco: string;
}

// ======== COMPONENTE ========

@Component({
  selector: 'app-despachante',
  standalone: true,
  imports: [FormsModule, PoModule],
  templateUrl: './despachante.html',
  styleUrl: './despachante.css',
})
export class Despachante implements OnInit, OnDestroy {

  @ViewChild('modalRota') modalRota!: PoModalComponent;

  // ─────── Dados do formulário ───────
  filtroData = new Date().toISOString().substring(0, 10);
  motoristaSelecionado = '';
  veiculoSelecionado = '';
  readonly pontodePartida = environment.pontoDePartida;

  // ─────── Filtros da tabela de pedidos ───────
  filtroBusca = '';
  filtroCidade = '';
  cidadesOptions: PoSelectOption[] = [];
  pedidosFiltrados: Pedido[] = [];

  // ─────── Seleção e rota ───────
  pedidosSelecionados: PedidoSelecionado[] = [];
  carregandoRota = false;
  carregandoDados = false;
  enviandoRota = false;
  rotaGerada: ItemRota[] = [];
  observacoesRota = '';
  resumoRota: ResumoRota | null = null;
  codigoRotaSalva = '';
  private mapa: L.Map | null = null;

  // ─────── Capacidade do veículo ───────
  capacidadeVeiculo = 0;
  private pedidos: Pedido[] = [];
  private veiculosConfig: Record<string, ConfigVeiculo> = {};

  // ─────── Opções dos selects ───────
  motoristas: PoSelectOption[] = [];
  veiculos: PoSelectOption[] = [];

  // ─────── Colunas das tabelas ───────
  readonly colunasPedidos: PoTableColumn[] = [
    { property: 'numero', label: 'Pedido' },
    { property: 'nomeCliente', label: 'Cliente' },
    { property: 'endereco', label: 'Endereço' },
    { property: 'cidade', label: 'Cidade' },
    { property: 'volumes', label: 'Volumes', type: 'number' },
  ];

  readonly colunasRota: PoTableColumn[] = [
    { property: 'seq', label: 'Ordem' },
    { property: 'numero', label: 'Pedido' },
    { property: 'nomeCliente', label: 'Cliente' },
    { property: 'endereco', label: 'Endereço' },
    { property: 'cidade', label: 'Cidade' },
    { property: 'distanciaKm', label: 'Dist. (km)' },
    { property: 'tempoMin', label: 'Tempo (min)' },
    { property: 'motivo', label: 'Motivo' },
  ];

  // ─────── Ações do modal ───────
  readonly acaoFechar: PoModalAction = {
    label: 'Fechar',
    action: () => {
      this.destruirMapa();
      this.codigoRotaSalva = '';
      this.modalRota.close();
    },
  };

  readonly acaoEnviarMotorista: PoModalAction = {
    label: 'Enviar ao Motorista',
    action: () => this.enviarRotaMotorista(),
  };

  // ─────── Destroy notifier ───────
  private readonly destroy$ = new Subject<void>();

  // ─────── Getters ───────

  get etapaAtual(): number {
    if (this.pedidosSelecionados.length > 0) return 3;
    if (this.motoristaSelecionado && this.veiculoSelecionado) return 2;
    return 1;
  }

  get totalVolumes(): number {
    return this.pedidosSelecionados.reduce((acc, p) => acc + (p.volumes || 0), 0);
  }

  get percentualCapacidade(): number {
    if (!this.capacidadeVeiculo) return 0;
    return Math.min((this.totalVolumes / this.capacidadeVeiculo) * 100, 100);
  }

  get capacidadeExcedida(): boolean {
    return this.capacidadeVeiculo > 0 && this.totalVolumes > this.capacidadeVeiculo;
  }

  // ─────── Constructor ───────
  constructor(
    private readonly notification: PoNotificationService,
    private readonly tracklogService: TracklogService,
  ) { }

  // ─────── Lifecycle ───────
  ngOnInit(): void {
    this.carregarDados();
  }

  ngOnDestroy(): void {
    this.destruirMapa();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ─────── Carregamento de dados com forkJoin ───────
  private carregarDados(): void {
    this.carregandoDados = true;

    forkJoin({
      motoristas: this.tracklogService.getMotoristas(),
      veiculos: this.tracklogService.getVeiculos(),
      pedidos: this.tracklogService.getPedidos(),
    })
      .pipe(
        takeUntil(this.destroy$),
        finalize(() => { this.carregandoDados = false; }),
      )
      .subscribe({
        next: ({ motoristas, veiculos, pedidos }) => {
          this.processarMotoristas(motoristas);
          this.processarVeiculos(veiculos);
          this.processarPedidos(pedidos);
        },
        error: () => this.notification.error('Erro ao carregar dados!'),
      });
  }

  private processarMotoristas(res: { success: boolean; data: Array<{ nome: string; situacao: string; codigo: string }> }): void {
    if (!res.success) return;
    this.motoristas = res.data.map(m => ({
      label: `${m.nome}${m.situacao === '1' ? ' 🔴 Bloqueado' : ''}`,
      value: m.codigo,
      disabled: m.situacao === '1',
    }));
  }

  private processarVeiculos(res: { success: boolean; data: Array<{ modelo: string; placa: string; codigo: string; capacNom: number }> }): void {
    if (!res.success) return;

    this.veiculos = res.data.map(v => ({
      label: `${v.modelo} - ${v.placa}`,
      value: v.codigo,
    }));

    res.data.forEach(v => {
      const isCaminhao = v.modelo?.toLowerCase().includes('caminhão');
      this.veiculosConfig[v.codigo] = {
        nome: `${v.modelo} - ${v.placa}`,
        consumo: isCaminhao ? 8 : 12,
        combustivel: isCaminhao ? 'Diesel' : 'Gasolina',
        precoCombustivel: 6.20,
        capacidade: v.capacNom || 0,
      };
    });
  }

  private processarPedidos(res: { success: boolean; data: Pedido[] }): void {
    if (!res.success) return;
    this.pedidos = res.data;
    this.pedidosFiltrados = [...this.pedidos];

    const cidades = [...new Set(res.data.map(p => p.cidade).filter(Boolean))];
    this.cidadesOptions = [
      { label: 'Todas as cidades', value: '' },
      ...cidades.sort().map(c => ({ label: c, value: c })),
    ];
  }

  // ─────── Eventos de seleção ───────
  onMotoristaMudou(codigo: string): void {
    this.motoristaSelecionado = codigo;
  }

  onVeiculoMudou(codigo: string): void {
    this.veiculoSelecionado = codigo;
    this.capacidadeVeiculo = this.veiculosConfig[codigo]?.capacidade || 0;
  }

  // ─────── Filtros da tabela ───────
  filtrarPedidos(): void {
    const busca = this.filtroBusca.toLowerCase().trim();
    const cidade = this.filtroCidade;

    this.pedidosFiltrados = this.pedidos.filter(p => {
      const matchBusca = !busca || p.numero?.toLowerCase().includes(busca) || p.nomeCliente?.toLowerCase().includes(busca);
      const matchCidade = !cidade || p.cidade === cidade;
      return matchBusca && matchCidade;
    });
  }

  limparFiltros(): void {
    this.filtroBusca = '';
    this.filtroCidade = '';
    this.pedidosFiltrados = [...this.pedidos];
  }

  // ─────── Seleção de pedidos ───────
  onSelecionarPedido(pedido: Pedido): void {
    if (this.pedidosSelecionados.some(p => p.numero === pedido.numero)) return;
    this.pedidosSelecionados = [
      ...this.pedidosSelecionados,
      { ...pedido, seq: this.pedidosSelecionados.length + 1 },
    ];
  }

  onDeselecionarPedido(pedido: Pedido): void {
    this.pedidosSelecionados = this.pedidosSelecionados
      .filter(p => p.numero !== pedido.numero)
      .map((p, i) => ({ ...p, seq: i + 1 }));
  }

  limparSelecao(): void {
    this.pedidosSelecionados = [];
    this.pedidos = this.pedidos.map(p => ({ ...p, $selected: false }));
    this.pedidosFiltrados = this.pedidosFiltrados.map(p => ({ ...p, $selected: false }));
  }

  // ─────── Geocodificação ───────
  private async geocodificar(endereco: string): Promise<[number, number] | null> {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(endereco)}&countrycodes=br&limit=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
      const data = await res.json() as Array<{ lat: string; lon: string }>;
      if (data.length > 0) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    } catch { /* falha silenciosa — ponto não será plotado */ }
    return null;
  }

  // ─────── Renderização do mapa ───────
  private async renderizarMapa(pontos: PontomMapa[]): Promise<void> {
    await new Promise(r => setTimeout(r, 300));
    this.destruirMapa();

    const el = document.getElementById('mapa-rota');
    if (!el) return;

    this.mapa = L.map('mapa-rota').setView([-22.7, -47.4], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(this.mapa);

    const coordenadas: [number, number][] = [];

    for (let i = 0; i < pontos.length; i++) {
      const coords = await this.geocodificar(pontos[i].endereco);
      if (!coords) continue;

      coordenadas.push(coords);

      const icone = L.divIcon({
        className: '',
        html: `<div style="
          background:${i === 0 ? '#2c6ef2' : '#764ab0'};
          color:white; border-radius:50%;
          width:28px; height:28px;
          display:flex; align-items:center; justify-content:center;
          font-weight:bold; font-size:13px;
          border:2px solid white;
          box-shadow:0 2px 4px rgba(0,0,0,0.3);
        ">${i === 0 ? '★' : i}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      L.marker(coords, { icon: icone })
        .addTo(this.mapa!)
        .bindPopup(`<b>${pontos[i].label}</b><br>${pontos[i].endereco}`);
    }

    if (coordenadas.length > 1) {
      L.polyline(coordenadas, { color: '#764ab0', weight: 3, dashArray: '6,6' }).addTo(this.mapa!);
      this.mapa!.fitBounds(L.latLngBounds(coordenadas).pad(0.2));
    }
  }

  private destruirMapa(): void {
    if (this.mapa) {
      this.mapa.remove();
      this.mapa = null;
    }
  }

  // ─────── Geração da rota via Groq ───────
  async gerarRota(): Promise<void> {
    if (!this.motoristaSelecionado) { this.notification.warning('Selecione um motorista!'); return; }
    if (!this.veiculoSelecionado) { this.notification.warning('Selecione um veículo!'); return; }
    if (!this.pedidosSelecionados.length) { this.notification.warning('Selecione pedidos!'); return; }

    this.rotaGerada = [];
    this.resumoRota = null;
    this.observacoesRota = '';
    this.codigoRotaSalva = '';
    this.carregandoRota = true;
    this.modalRota.open();

    const veiculo = this.veiculosConfig[this.veiculoSelecionado] ?? { nome: 'Veículo', consumo: 10, combustivel: 'Gasolina', precoCombustivel: 6.20, capacidade: 0 };
    const listaPedidos = this.pedidosSelecionados
      .map(p => `Pedido ${p.numero} - ${p.nomeCliente} - ${p.endereco}, ${p.cidade}`)
      .join('\n');

    const prompt = `
Você é um especialista em logística e roteirização de entregas no Brasil.
Ponto de partida: ${this.pontodePartida}
Pedidos para entregar:
${listaPedidos}
Para cada parada, estime a distância em km e o tempo em minutos desde a parada anterior.
Considere velocidade média de 70 km/h em rodovias e 30 km/h em cidade.
Retorne APENAS um JSON válido, sem explicações, sem markdown:
{"rota":[{"seq":1,"numero":"000001","distanciaKm":45,"tempoMin":40,"motivo":"motivo resumido"}],"totalKm":150,"totalMin":180,"observacoes":"observação geral"}
`;

    try {
      const response = await fetch(environment.groqApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${environment.groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.1,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await response.json() as { choices: Array<{ message: { content: string } }> };
      const texto = data.choices[0].message.content.trim();
      const parsed = JSON.parse(texto) as RespostaGroq;

      this.rotaGerada = parsed.rota.map(item => {
        const pedido = this.pedidosSelecionados.find(p => p.numero === item.numero);
        return {
          ...pedido!,
          seq: item.seq,
          distanciaKm: item.distanciaKm,
          tempoMin: item.tempoMin,
          motivo: item.motivo,
        } as ItemRota;
      });

      const litros = parsed.totalKm / veiculo.consumo;
      const custo = litros * veiculo.precoCombustivel;

      this.resumoRota = {
        distancia: `${parsed.totalKm} km`,
        tempo: `${Math.floor(parsed.totalMin / 60)}h ${parsed.totalMin % 60}min`,
        litros: `${litros.toFixed(1)} L`,
        custo: `R$ ${custo.toFixed(2)}`,
        veiculo: veiculo.nome,
        combustivel: veiculo.combustivel,
      };

      this.observacoesRota = parsed.observacoes;
      this.carregandoRota = false;

      const pontos: PontomMapa[] = [
        { label: 'Ponto de Partida', endereco: this.pontodePartida },
        ...this.rotaGerada.map(p => ({
          label: `${p.seq}. ${p.nomeCliente}`,
          endereco: `${p.endereco}, ${p.cidade}, SP, Brasil`,
        })),
      ];

      await this.renderizarMapa(pontos);

    } catch {
      this.notification.error('Erro ao calcular rota com IA!');
      this.modalRota.close();
      this.carregandoRota = false;
    }
  }

  // ─────── Enviar rota ao motorista ───────
  enviarRotaMotorista(): void {
    if (!this.rotaGerada.length) {
      this.notification.warning('Gere a rota antes de enviar!');
      return;
    }

    const cod = 'R' + Date.now().toString().slice(-5);
    const dataFormatada = this.filtroData.replace(/-/g, '');

    const payload: PayloadSalvarRota = {
      cod: cod,
      motor: this.motoristaSelecionado,
      veic: this.veiculoSelecionado,
      data: dataFormatada,
      obs: this.observacoesRota || '',
      totalPedidos: String(this.rotaGerada.length),
    };

    this.rotaGerada.forEach((p, i) => {
      payload[`pedido${i + 1}`] = p.numero;
      payload[`seq${i + 1}`] = String(i + 1).padStart(3, '0');
    });

    this.enviandoRota = true;
    this.acaoEnviarMotorista.loading = true;

    this.tracklogService.salvarRota(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res: { success: boolean; cod?: string; message?: string }) => {
          this.enviandoRota = false;
          this.acaoEnviarMotorista.loading = false;

          if (res.success) {
            this.codigoRotaSalva = res.cod || cod;
            this.notification.success(`Rota ${this.codigoRotaSalva} enviada ao motorista com sucesso!`);
            this.limparAposEnvio();
          } else {
            this.notification.error('Erro ao enviar rota: ' + (res.message || ''));
          }
        },
        error: () => {
          this.enviandoRota = false;
          this.acaoEnviarMotorista.loading = false;
          this.notification.error('Erro ao enviar rota ao motorista!');
        },
      });
  }

  private limparAposEnvio(): void {
    const numerosRoteirizados = this.rotaGerada.map(p => p.numero);
    this.pedidos = this.pedidos.filter(p => !numerosRoteirizados.includes(p.numero));
    this.pedidosFiltrados = this.pedidosFiltrados.filter(p => !numerosRoteirizados.includes(p.numero));
    this.pedidosSelecionados = [];
    this.rotaGerada = [];
    this.observacoesRota = '';
    this.resumoRota = null;
    this.destruirMapa();
    this.modalRota.close();
  }
}