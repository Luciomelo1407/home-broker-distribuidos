import { Controller, Get, Header } from '@nestjs/common';
import { MetricasService } from './metricas.service';

@Controller('metrics')
export class MetricasController {
  constructor(private readonly metricas: MetricasService) {}

  /** RF-026: lido pelo Prometheus (infra/prometheus). Público, como de costume no scrape. */
  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  expor(): Promise<string> {
    return this.metricas.expor();
  }
}
