import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import {
  PoModule,
  PoSelectOption,
  PoNotificationService,
  PoModalAction,
  PoModalComponent,
} from '@po-ui/ng-components';
import { Subject, takeUntil } from 'rxjs';
import {
  TracklogService,
  MotoristaDto,
  RotaDto,
  PayloadLocalizacao,
  PayloadAtualizarPedido,
} from '../../services/tracklog.service';

// ════════ INTERFACES INTERNAS ════════

interface Parada {
  pedido: string;
  seq: number;
  nomeCliente: string;
  endereco: string;
  bairro?: string;
  cidade?: string;
  status: '0' | '1' | '2' | '3';
  statusLabel?: string;
  volumes?: number;
  peso?: number;
}

interface TipoOcorrencia {
  label: string;
  value: string;
}

interface TipoChegada {
  label: string;
  value: string;
  icone: string;
}

// ════════ CONSTANTES ════════

const ICONES_OCORRENCIA: Record<string, string> = {
  CLIENTE_AUSENTE: '🚪',
  ENDERECO_NAO_ENCONTRADO: '🗺️',
  RECUSA_MERCADORIA: '🚫',
  AVARIA: '📦',
  ESTABELECIMENTO_FECHADO: '🔒',
  DIVERGENCIA_NF: '📋',
  ACESSO_RESTRITO: '⛔',
  OUTROS: '💬',
};

const LABELS_STATUS: Record<string, string> = {
  '0': 'Pendente',
  '1': 'Chegou',
  '2': 'Entregue',
  '3': 'Problema',
};

// ════════ COMPONENTE ════════

@Component({
  selector: 'app-motorista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Default,
  imports: [CommonModule, FormsModule, PoModule],
  templateUrl: './motorista.html',
  styleUrl: './motorista.css',
})
export class Motorista implements OnInit, OnDestroy {

  @ViewChild('modalObs') modalObs!: PoModalComponent;

  // ── ViewChild para o canvas (evita document.getElementById) ──
  @ViewChild('canvasAssinatura') canvasAssinaturaRef?: ElementRef<HTMLCanvasElement>;

  // ───────── Seleção ─────────
  motoristaSelecionado = '';
  motoristas: PoSelectOption[] = [];
  carregandoMotoristas = false;
  buscandoRota = false;

  // ───────── Rota e paradas ─────────
  rota: RotaDto | null = null;
  paradas: Parada[] = [];
  rotaCod = '';

  // ───────── UI ─────────
  drawerCollapsed = false;
  temaEscuro = false;
  tela: 'selecao' | 'rota' = 'selecao';

  // ───────── Tempo em rota ─────────
  rotaInicio: Date | null = null;
  tempoEmRota = '0h 00min';
  private tempoInterval: ReturnType<typeof setInterval> | null = null;

  // ───────── Modal ─────────
  obsTexto = '';
  statusModal = '';
  paradaModal: Parada | null = null;

  // ───────── Ocorrências ─────────
  readonly tiposOcorrencia: TipoOcorrencia[] = [
    { label: 'Cliente ausente', value: 'CLIENTE_AUSENTE' },
    { label: 'Endereço não encontrado', value: 'ENDERECO_NAO_ENCONTRADO' },
    { label: 'Recusa de mercadoria', value: 'RECUSA_MERCADORIA' },
    { label: 'Avaria na mercadoria', value: 'AVARIA' },
    { label: 'Estabelecimento fechado', value: 'ESTABELECIMENTO_FECHADO' },
    { label: 'Divergência de NF', value: 'DIVERGENCIA_NF' },
    { label: 'Acesso restrito', value: 'ACESSO_RESTRITO' },
    { label: 'Outros', value: 'OUTROS' },
  ];
  tipoOcorrenciaSelecionado = '';

  readonly tiposChegada: TipoChegada[] = [
    { label: 'Cliente presente', value: 'CLIENTE_PRESENTE', icone: '🚪' },
    { label: 'Portaria / Recepção', value: 'PORTARIA', icone: '🏢' },
    { label: 'Aguardando descarga', value: 'AGUARDANDO_DESCARGA', icone: '⏳' },
    { label: 'Avisando cliente', value: 'AVISANDO_CLIENTE', icone: '🔔' },
    { label: 'Posicionando veículo', value: 'POSICIONANDO_VEICULO', icone: '🚛' },
    { label: 'Contato por telefone', value: 'CONTATO_TELEFONE', icone: '📞' },
  ];
  tipoChegadaSelecionado = '';

  // ───────── Assinatura ─────────
  assinaturaBase64 = '';
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private desenhando = false;

  // ───────── Foto ─────────
  fotoBase64 = '';

  // ───────── GPS ─────────
  gpsAtivo = false;
  velocidadeAtual = 0;
  private gpsInterval: ReturnType<typeof setInterval> | null = null;
  private mapa: L.Map | null = null;
  private marcadorMotorista: L.Marker | null = null;
  private coordsRotaAtual: [number, number][] = [];
  private linhaPercurso: L.Polyline | null = null;

  // ───────── Percurso ─────────
  kmPercorridos = 0;
  kmTotaisEstimado = 0;
  private ultimaPos: GeolocationPosition | null = null;
  private trajeto: [number, number][] = [];

  // ───────── Ações do modal ─────────
  readonly acaoConfirmar: PoModalAction = {
    label: 'Confirmar',
    action: () => this.confirmarStatus(),
  };

  readonly acaoCancelar: PoModalAction = {
    label: 'Cancelar',
    action: () => this.modalObs.close(),
  };

  // ───────── Destroy notifier ─────────
  private readonly destroy$ = new Subject<void>();

  // ════════ GETTERS ════════

  get proximaParada(): Parada | null {
    return this.paradas.find(p => p.status === '0') ?? null;
  }

  get etaPrevista(): string {
    if (!this.proximaParada) return '--:--';
    const eta = new Date(Date.now() + this.paradasPendentes * 30 * 60_000);
    return eta.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  get paradasPendentes(): number {
    return this.paradas.filter(p => p.status === '0' || p.status === '1').length;
  }

  get paradasEntregues(): number {
    return this.paradas.filter(p => p.status === '2').length;
  }

  get paradasProblema(): number {
    return this.paradas.filter(p => p.status === '3').length;
  }

  get progressoPct(): number {
    return this.paradas.length
      ? Math.round((this.paradasEntregues / this.paradas.length) * 100)
      : 0;
  }

  get kmPercorridosFormatado(): string {
    return this.kmPercorridos.toFixed(1);
  }

  get nomeMotoristaLabel(): string {
    const m = this.motoristas.find(x => x.value === this.motoristaSelecionado);
    return m ? String(m.label).split(' - ').slice(1).join(' - ') : '';
  }

  get inicialMotorista(): string {
    return this.nomeMotoristaLabel
      ? this.nomeMotoristaLabel.charAt(0).toUpperCase()
      : 'M';
  }

  get tituloModal(): string {
    const titulos: Record<string, string> = {
      '1': '📍 Confirmar Chegada',
      '2': '✅ Confirmar Entrega',
      '3': '❌ Registrar Ocorrência',
    };
    return titulos[this.statusModal] ?? 'Status';
  }

  // ════════ CONSTRUCTOR ════════

  constructor(
    private readonly notification: PoNotificationService,
    private readonly tracklogService: TracklogService,
    private readonly cdr: ChangeDetectorRef,
  ) { }

  // ════════ LIFECYCLE ════════

  ngOnInit(): void {
    this.carregarMotoristas();
  }

  ngOnDestroy(): void {
    this.pararGPS();
    this.pararTempo();
    this.destruirMapa();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ════════ MOTORISTAS ════════

  private carregarMotoristas(): void {
    this.carregandoMotoristas = true;

    this.tracklogService.getMotoristas()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          if (res.success) {
            this.motoristas = res.data.map((m: MotoristaDto) => ({
              label: `${m.codigo} - ${m.nome}`,
              value: m.codigo,
            }));
          }
          this.carregandoMotoristas = false;
        },
        error: () => {
          this.notification.error('Erro ao carregar motoristas!');
          this.carregandoMotoristas = false;
        },
      });
  }

  onMotoristaMudou(codigo: string): void {
    this.motoristaSelecionado = codigo;
  }

  // ════════ BUSCA DE ROTA ════════

  buscarRota(): void {
    if (!this.motoristaSelecionado) {
      this.notification.warning('Selecione um motorista!');
      return;
    }

    this.buscandoRota = true;

    this.tracklogService.getRotaMotorista(this.motoristaSelecionado)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.buscandoRota = false;

          if (!res.success) {
            this.notification.warning(res.message ?? 'Nenhuma rota ativa encontrada!');
            return;
          }

          const rotaData = res.data as RotaDto;
          this.rota = rotaData;
          this.rotaCod = rotaData.cod;
          this.paradas = (rotaData.pedidos ?? [])
            .sort((a, b) => Number(a.seq) - Number(b.seq))
            .map(p => ({ ...p, statusLabel: this.labelStatus(p.status) }));

          this.kmTotaisEstimado = this.paradas.length * 15;
          this.tela = 'rota';
          this.rotaInicio = new Date();

          this.iniciarContadorTempo();
          setTimeout(() => this.iniciarMapa(), 400);
          this.iniciarGPS();
        },
        error: () => {
          this.buscandoRota = false;
          this.notification.error('Erro ao buscar rota!');
        },
      });
  }

  voltarSelecao(): void {
    this.pararGPS();
    this.pararTempo();
    this.destruirMapa();

    this.tela = 'selecao';
    this.rota = null;
    this.paradas = [];
    this.rotaCod = '';
    this.rotaInicio = null;
    this.tempoEmRota = '0h 00min';
    this.coordsRotaAtual = [];
    this.kmPercorridos = 0;
    this.trajeto = [];
    this.ultimaPos = null;
    this.velocidadeAtual = 0;
  }

  // ════════ CONTADOR DE TEMPO ════════

  private iniciarContadorTempo(): void {
    this.atualizarTempo();
    this.tempoInterval = setInterval(() => this.atualizarTempo(), 60_000);
  }

  private atualizarTempo(): void {
    if (!this.rotaInicio) return;
    const diff = Math.floor((Date.now() - this.rotaInicio.getTime()) / 60_000);
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    this.tempoEmRota = `${h}h ${m.toString().padStart(2, '0')}min`;
  }

  private pararTempo(): void {
    if (this.tempoInterval) {
      clearInterval(this.tempoInterval);
      this.tempoInterval = null;
    }
  }

  // ════════ MAPA LEAFLET ════════

  /* Inicializa o mapa e plota todos os marcadores em paralelo. As geocodificações são disparadas simultaneamente com Promise.allSettled, reduzindo o tempo de carregamento de O(n) serial para O(1) paralelo. */
  private async iniciarMapa(): Promise<void> {
    this.destruirMapa();

    const el = document.getElementById('mapa-motorista');
    if (!el) return;

    this.mapa = L.map('mapa-motorista').setView([-22.7, -47.4], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(this.mapa);

    setTimeout(() => this.mapa?.invalidateSize(), 100);

    // ── Geocodifica todas as paradas em paralelo ──
    const geocodPromises = this.paradas.map(p => {
      const partes = [p.endereco, p.bairro, p.cidade, 'SP', 'Brasil']
        .filter(v => v && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'undefined');
      return this.geocodificar(partes.join(', '));
    });

    const resultados = await Promise.allSettled(geocodPromises);
    const coords: [number, number][] = [];

    resultados.forEach((resultado, i) => {
      const coord = resultado.status === 'fulfilled' ? resultado.value : null;
      coords.push(coord ?? [0, 0]);

      if (!coord) return;

      const p = this.paradas[i];
      this.plotarMarcador(p, coord);
    });

    // Filtra coords inválidas (paradas sem geocodificação)
    this.coordsRotaAtual = coords.filter(c => c[0] !== 0 && c[1] !== 0);

    if (this.coordsRotaAtual.length > 1) {
      L.polyline(this.coordsRotaAtual, {
        color: '#e85d04', weight: 3, dashArray: '8,5', opacity: 0.7,
      }).addTo(this.mapa!);
      this.mapa!.fitBounds(L.latLngBounds(this.coordsRotaAtual).pad(0.25));
    } else if (this.coordsRotaAtual.length === 1) {
      this.mapa!.setView(this.coordsRotaAtual[0], 13);
    }

    if (this.trajeto.length > 1) {
      this.linhaPercurso = L.polyline(this.trajeto, {
        color: '#60a5fa', weight: 3, opacity: 0.8,
      }).addTo(this.mapa!);
    }
  }

  /* Plota (ou atualiza) o marcador de uma parada individual. Chamado após confirmar status para evitar recarregar o mapa inteiro. */
  private plotarMarcador(parada: Parada, coord: [number, number]): void {
    if (!this.mapa) return;

    const isProxima = this.proximaParada?.pedido === parada.pedido;
    const cor = parada.status === '2' ? '#2d8a4e'
      : parada.status === '3' ? '#c0392b'
        : parada.status === '1' ? '#1a6fa8'
          : '#e85d04';
    const escala = isProxima ? '1.2' : '1';
    const borda = isProxima ? '3px solid #fff' : '2px solid #fff';

    const icone = L.divIcon({
      className: '',
      html: this.buildIconeHtml(parada.seq, cor, borda, escala, isProxima),
      iconSize: [32, 32],
      iconAnchor: [16, 32],
    });

    L.marker(coord, { icon: icone })
      .addTo(this.mapa)
      .bindPopup(this.buildPopupHtml(parada, coord, cor));
  }

  /* Gera o HTML do ícone do marcador (extraído para não poluir o método principal). */
  private buildIconeHtml(
    seq: number,
    cor: string,
    borda: string,
    escala: string,
    isProxima: boolean,
  ): string {
    const sombra = isProxima
      ? '0 4px 16px rgba(232,93,4,.6)'
      : '0 3px 10px rgba(0,0,0,.35)';
    const conteudo = isProxima ? '📍' : String(seq);

    return `<div style="background:${cor};color:#fff;border-radius:50% 50% 50% 0;
      width:32px;height:32px;display:flex;align-items:center;justify-content:center;
      font-weight:700;font-size:13px;border:${borda};
      transform:rotate(-45deg) scale(${escala});
      box-shadow:${sombra};font-family:'IBM Plex Sans',sans-serif">
      <span style="transform:rotate(45deg)">${conteudo}</span>
    </div>`;
  }

  /* Gera o HTML do popup do marcador. */
  private buildPopupHtml(parada: Parada, coord: [number, number], cor: string): string {
    const endereco = [parada.endereco, parada.bairro, parada.cidade, 'SP', 'Brasil']
      .filter(v => v && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'undefined')
      .join(', ');

    const horaPrevista = this.calcularHoraPrevista(parada.seq);
    const isProxima = this.proximaParada?.pedido === parada.pedido;

    return `
      <div style="font-family:'IBM Plex Sans',sans-serif;min-width:210px">
        <div style="font-size:10px;color:#9e9890;margin-bottom:4px;font-family:'IBM Plex Mono',monospace">
          PARADA ${parada.seq}${isProxima ? ' · PRÓXIMA' : ''}
        </div>
        <div style="font-size:13px;font-weight:700;margin-bottom:2px">
          ${parada.nomeCliente || 'Cliente não informado'}
        </div>
        <div style="font-size:11px;color:#6b6560;margin-bottom:8px">${endereco}</div>
        ${parada.volumes ? `<div style="font-size:11px;color:#6b6560;margin-bottom:4px">📦 ${parada.volumes} vol · ${parada.peso ?? '?'} kg</div>` : ''}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
          <span style="padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;
            background:${cor}20;color:${cor};border:1px solid ${cor}40">
            ${this.labelStatus(parada.status)}
          </span>
          <span style="font-size:10px;color:#9e9890;font-family:'IBM Plex Mono',monospace">
            ⏱ ~${horaPrevista}
          </span>
        </div>
        <div style="font-size:10px;color:#9e9890;margin-top:6px;font-family:'IBM Plex Mono',monospace">
          NF ${parada.pedido}
        </div>
      </div>`;
  }

  private destruirMapa(): void {
    if (this.mapa) {
      this.mapa.remove();
      this.mapa = null;
    }
    this.marcadorMotorista = null;
    this.linhaPercurso = null;
  }

  calcularHoraPrevista(seq: number): string {
    if (!this.rotaInicio) return '--:--';
    const eta = new Date(this.rotaInicio.getTime() + (seq - 1) * 35 * 60_000);
    return eta.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  private async geocodificar(endereco: string): Promise<[number, number] | null> {
    if (!endereco || endereco.length < 5) return null;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(endereco)}&countrycodes=br&limit=1`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'pt-BR', 'User-Agent': 'TracklogApp/1.0' },
      });
      const data = await res.json() as Array<{ lat: string; lon: string }>;
      if (data?.length > 0) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    } catch {
      // Falha silenciosa — ponto não será plotado no mapa
    }
    return null;
  }

  // ════════ CONTROLES DO MAPA ════════

  zoomIn(): void { this.mapa?.zoomIn(); }
  zoomOut(): void { this.mapa?.zoomOut(); }

  centralizarMapa(): void {
    if (!this.mapa) return;
    if (this.coordsRotaAtual.length > 1) {
      this.mapa.fitBounds(L.latLngBounds(this.coordsRotaAtual).pad(0.25));
    } else if (this.coordsRotaAtual.length === 1) {
      this.mapa.setView(this.coordsRotaAtual[0], 13);
    } else if (this.marcadorMotorista) {
      this.mapa.setView(this.marcadorMotorista.getLatLng(), 14);
    }
  }

  centralizarNaProxima(): void {
    if (!this.mapa || !this.proximaParada) return;
    const idx = this.paradas.findIndex(p => p.pedido === this.proximaParada!.pedido);
    if (idx >= 0 && this.coordsRotaAtual[idx]) {
      this.mapa.setView(this.coordsRotaAtual[idx], 15);
    }
  }

  // ════════ GPS ════════

  private iniciarGPS(): void {
    if (!navigator.geolocation) return;
    this.gpsAtivo = true;

    const enviar = (): void => {
      navigator.geolocation.getCurrentPosition(pos => {
        const { latitude, longitude, speed } = pos.coords;
        this.velocidadeAtual = speed ? Math.round(speed * 3.6) : 0;

        if (this.ultimaPos) {
          this.kmPercorridos += this.calcularDistancia(
            this.ultimaPos.coords.latitude, this.ultimaPos.coords.longitude,
            latitude, longitude,
          );
        }
        this.ultimaPos = pos;
        this.trajeto.push([latitude, longitude]);

        this.atualizarTrajetoNoMapa(latitude, longitude);

        const payload: PayloadLocalizacao = {
          rota: this.rotaCod, lat: latitude, lng: longitude,
          status: '1', velocidade: this.velocidadeAtual,
        };

        this.tracklogService.logLocalizacao(payload)
          .pipe(takeUntil(this.destroy$))
          .subscribe({ error: () => { /* falha silenciosa */ } });
      });
    };

    enviar();
    this.gpsInterval = setInterval(enviar, 30_000);
  }

  private atualizarTrajetoNoMapa(lat: number, lng: number): void {
    if (!this.mapa) return;

    if (this.linhaPercurso) {
      this.linhaPercurso.setLatLngs(this.trajeto);
    } else {
      this.linhaPercurso = L.polyline(this.trajeto, {
        color: '#60a5fa', weight: 3, opacity: 0.8,
      }).addTo(this.mapa);
    }

    const icone = L.divIcon({
      className: '',
      html: `<div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center">
        <div style="position:absolute;inset:0;border-radius:50%;background:rgba(232,93,4,0.15);animation:truckPulse 2s infinite"></div>
        <div style="position:absolute;inset:-8px;border-radius:50%;border:2px solid rgba(232,93,4,0.3);animation:truckRing 2s infinite"></div>
        <div style="background:#e85d04;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;
          border:2px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.4);font-size:14px;z-index:1">🚚</div>
      </div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

    if (this.marcadorMotorista) {
      this.marcadorMotorista.setLatLng([lat, lng]);
    } else {
      this.marcadorMotorista = L.marker([lat, lng], { icon: icone })
        .addTo(this.mapa)
        .bindPopup('📍 Você está aqui');
    }
  }

  private calcularDistancia(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private pararGPS(): void {
    this.gpsAtivo = false;
    if (this.gpsInterval) {
      clearInterval(this.gpsInterval);
      this.gpsInterval = null;
    }
  }

  // ════════ MODAL ════════

  abrirModal(parada: Parada, status: string): void {
    this.paradaModal = parada;
    this.statusModal = status;
    this.obsTexto = '';
    this.tipoOcorrenciaSelecionado = '';
    this.tipoChegadaSelecionado = '';
    this.assinaturaBase64 = '';
    this.fotoBase64 = '';
    this.modalObs.open();

    if (status === '2') {
      setTimeout(() => this.iniciarCanvas(), 300);
    }
  }

  // ════════ CANVAS DE ASSINATURA ════════

  /* Usa ViewChild quando disponível, com fallback para getElementById. Isso permite que o template use #canvasAssinatura no elemento. */
  private iniciarCanvas(): void {
    const canvas = this.canvasAssinaturaRef?.nativeElement
      ?? (document.getElementById('canvas-assinatura') as HTMLCanvasElement | null);

    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.canvasCtx = ctx;
    ctx.strokeStyle = '#1a1714';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const getPos = (e: MouseEvent | TouchEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      if (e instanceof TouchEvent) {
        return {
          x: e.touches[0].clientX - rect.left,
          y: e.touches[0].clientY - rect.top,
        };
      }
      return {
        x: (e as MouseEvent).clientX - rect.left,
        y: (e as MouseEvent).clientY - rect.top,
      };
    };

    const onStart = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      this.desenhando = true;
      const pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      if (!this.desenhando) return;
      const pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    };

    const onEnd = () => {
      this.desenhando = false;
      this.assinaturaBase64 = canvas.toDataURL('image/png');
    };

    canvas.addEventListener('mousedown', onStart);
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('mouseup', onEnd);
    canvas.addEventListener('touchend', onEnd);
  }

  selecionarOcorrencia(value: string): void {
    this.tipoOcorrenciaSelecionado = value;
    this.cdr.detectChanges();
  }

  selecionarChegada(value: string): void {
    this.tipoChegadaSelecionado = value;
    const tipo = this.tiposChegada.find(t => t.value === value);
    if (tipo) this.obsTexto = tipo.label;
    this.cdr.detectChanges();
  }

  limparAssinatura(): void {
    const canvas = this.canvasAssinaturaRef?.nativeElement
      ?? (document.getElementById('canvas-assinatura') as HTMLCanvasElement | null);
    if (!canvas || !this.canvasCtx) return;
    this.canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    this.assinaturaBase64 = '';
  }

  // ════════ FOTO ════════

  tirarFoto(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const reader = new FileReader();
    reader.onload = e => { this.fotoBase64 = e.target?.result as string; };
    reader.readAsDataURL(input.files[0]);
  }

  removerFoto(): void {
    this.fotoBase64 = '';
  }

  // ════════ CONFIRMAR STATUS ════════

  confirmarStatus(): void {
    if (!this.paradaModal) return;

    if (this.statusModal === '3' && !this.tipoOcorrenciaSelecionado) {
      this.notification.warning('Selecione o tipo de ocorrência!');
      return;
    }

    const payload: PayloadAtualizarPedido = {
      rota: this.rotaCod,
      pedido: this.paradaModal.pedido,
      status: this.statusModal,
      obs: this.obsTexto,
      tipoOcorrencia: this.tipoOcorrenciaSelecionado,
      assinatura: this.assinaturaBase64,
      foto: this.fotoBase64,
    };

    this.tracklogService.atualizarPedido(payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          if (res.success) {
            const novoStatus = this.statusModal as Parada['status'];
            const paradaAtualizada: Parada | undefined = this.paradas.find(
              p => p.pedido === this.paradaModal!.pedido,
            );

            // Atualiza a lista de paradas de forma imutável
            this.paradas = this.paradas.map(p =>
              p.pedido === this.paradaModal!.pedido
                ? { ...p, status: novoStatus, statusLabel: this.labelStatus(novoStatus) }
                : p,
            );

            // Atualiza apenas o marcador da parada afetada — sem recarregar o mapa inteiro
            if (paradaAtualizada) {
              const idx = this.paradas.findIndex(p => p.pedido === paradaAtualizada.pedido);
              if (idx >= 0 && this.coordsRotaAtual[idx]) {
                const paradaComNovoStatus = this.paradas[idx];
                this.plotarMarcador(paradaComNovoStatus, this.coordsRotaAtual[idx]);
              }
            }

            this.notification.success('Status atualizado!');
            this.modalObs.close();
          }
        },
        error: () => this.notification.error('Erro ao atualizar status!'),
      });
  }

  // ════════ HELPERS PÚBLICOS ════════

  encodeEndereco(parada: Parada): string {
    const partes = [parada.endereco, parada.bairro, parada.cidade, 'SP']
      .filter(v => v && String(v).trim() !== '' && String(v).trim().toLowerCase() !== 'undefined');
    return encodeURIComponent(partes.join(', '));
  }

  labelStatus(status: string): string {
    return LABELS_STATUS[status] ?? status;
  }

  ocorrenciaIcone(value: string): string {
    return ICONES_OCORRENCIA[value] ?? '❓';
  }
}