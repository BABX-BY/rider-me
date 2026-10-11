import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { RouterOutlet } from '@angular/router';
import { Header } from './components/header/header';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Header],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly router = inject(Router);
  protected readonly isStandaloneRiderPage = signal(this.isStandaloneRiderUrl(this.router.url));

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.isStandaloneRiderPage.set(this.isStandaloneRiderUrl(event.urlAfterRedirects)));
  }

  private isStandaloneRiderUrl(url: string): boolean {
    return url.split('?')[0] === '/login' || url.split('?')[0] === '/rider/login' || url.split('?')[0] === '/rider/work';
  }
}
