import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';

// ════════ INTERFACES DE RESPOSTA ════════

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

export interface MotoristaDto {
  codigo: string;
  nome: string;
  situacao: string;
}

export interface VeiculoDto {
  codigo: string;
  placa: string;
  descricao: string;
  modelo: string;
  capacNom: number;
}

export interface PedidoDto {
  numero: string;
  pedido: string;
  seq: number;
  nomeCliente: string;
  endereco: string;
  bairro: string;
  cidade: string;
  status: '0' | '1' | '2' | '3';
  volumes: number;
  peso: number;
}

export interface RotaDto {
  cod: string;
  motor: string;
  obs?: string;
  pedidos: PedidoDto[];
}

export interface PayloadAtualizarPedido {
  rota: string;
  pedido: string;
  status: string;
  obs: string;
  tipoOcorrencia: string;
  assinatura: string;
  foto: string;
}

export interface PayloadLocalizacao {
  rota: string;
  lat: number;
  lng: number;
  status: string;
  velocidade: number;
}

export interface PayloadSalvarRota {
  cod: string;
  motor: string;
  veic: string;
  data: string;
  obs: string;
  totalPedidos: string;
  [key: string]: unknown;
}

// ════════ SERVICE ════════

@Injectable({ providedIn: 'root' })
export class TracklogService {

  private readonly baseUrl = environment.apiBaseUrl;
  private readonly headers: HttpHeaders;

  constructor(private readonly http: HttpClient) {
    const credenciais = btoa(`${environment.apiUsuario}:${environment.apiSenha}`);
    this.headers = new HttpHeaders({
      'Authorization': `Basic ${credenciais}`,
      'Content-Type': 'application/json',
    });
  }

  getMotoristas(): Observable<ApiResponse<MotoristaDto[]>> {
    return this.http.get<ApiResponse<MotoristaDto[]>>(
      `${this.baseUrl}/api/tracklog/motoristas`,
      { headers: this.headers },
    );
  }

  getVeiculos(): Observable<ApiResponse<VeiculoDto[]>> {
    return this.http.get<ApiResponse<VeiculoDto[]>>(
      `${this.baseUrl}/api/tracklog/veiculos`,
      { headers: this.headers },
    );
  }

  getPedidos(): Observable<ApiResponse<PedidoDto[]>> {
    return this.http.get<ApiResponse<PedidoDto[]>>(
      `${this.baseUrl}/api/tracklog/pedidos`,
      { headers: this.headers },
    );
  }

  salvarRota(payload: PayloadSalvarRota): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(
      `${this.baseUrl}/api/tracklog/rotas/salvar`,
      payload,
      { headers: this.headers },
    );
  }

  /**
   * Busca a rota ativa do motorista.
   *
   * Nota: o endpoint Protheus retorna a rota atual sem suporte a path/query params
   * neste ambiente, por isso a filtragem pelo código do motorista é feita aqui
   * no cliente. Quando o backend for atualizado, remover o `.pipe(map(...))`.
   */
  getRotaMotorista(codigoMotorista: string): Observable<ApiResponse<RotaDto> | { success: false; message: string }> {
    return this.http
      .get<ApiResponse<RotaDto>>(
        `${this.baseUrl}/api/tracklog/rotas/motorista`,
        { headers: this.headers },
      )
      .pipe(
        map(res => {
          if (res.success && res.data?.motor === codigoMotorista) {
            return res;
          }
          return {
            success: false as const,
            message: 'Nenhuma rota ativa encontrada para este motorista',
          };
        }),
      );
  }

  atualizarPedido(payload: PayloadAtualizarPedido): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(
      `${this.baseUrl}/api/tracklog/pedidos/atualizar`,
      payload,
      { headers: this.headers },
    );
  }

  logLocalizacao(payload: PayloadLocalizacao): Observable<ApiResponse<void>> {
    return this.http.post<ApiResponse<void>>(
      `${this.baseUrl}/api/tracklog/localizacao`,
      payload,
      { headers: this.headers },
    );
  }
}