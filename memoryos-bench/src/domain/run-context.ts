export interface BenchmarkClock {
  instant(): string;
  monotonicMilliseconds(): number;
}

export interface DatasetDescriptor {
  readonly source: string;
  readonly sha256: string;
}
