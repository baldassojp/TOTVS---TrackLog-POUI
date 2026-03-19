import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PoMenuItem, PoMenuModule, PoToolbarModule } from '@po-ui/ng-components';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, PoToolbarModule, PoMenuModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})

export class App {
  readonly menus: Array<PoMenuItem> = [
    { label: 'Despachante', link: '/despachante', icon: 'an an-truck' },
    { label: 'Motorista', link: '/motorista', icon: 'an an-user' }
  ];

}