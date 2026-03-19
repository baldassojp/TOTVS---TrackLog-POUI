import { Routes } from '@angular/router';
import { Despachante } from './pages/despachante/despachante';
import { Motorista } from './pages/motorista/motorista';

export const routes: Routes = [
  { path: '', redirectTo: 'despachante', pathMatch: 'full' },
  { path: 'despachante', component: Despachante },
  { path: 'motorista', component: Motorista }
];