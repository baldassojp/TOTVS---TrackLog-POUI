import { TestBed } from '@angular/core/testing';
import { TracklogService } from './tracklog.service';

describe('Tracklog', () => {
  let service: TracklogService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TracklogService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

});
