export interface Candle {
  number: number;
  name: string;
  description: string;
  lat: number;
  lng: number;
  flames: number;
  date: FirebaseFirestore.Timestamp;
  email?: string;
  orderId?: string;
  anonymous?: boolean;
}

export interface AddCandleDTO extends Candle {
  language?: string;
  project?: string;
  paymentId?: string; // Payconiq
}

export interface CandleDto {
  number: number;
  name: string;
  description: string;
  lat: number;
  lng: number;
  flames: number;
  formattedDate: string;
}

export interface TempCandle extends Candle {
  project: string;
}
