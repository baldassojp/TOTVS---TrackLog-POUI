import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Despachante } from './despachante';

describe('Despachante', () => {

  let component: Despachante;
  let fixture: ComponentFixture<Despachante>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Despachante]
    })

    .compileComponents();

    fixture = TestBed.createComponent(Despachante);
    component = fixture.componentInstance;
    fixture.detectChanges();

  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  
});
