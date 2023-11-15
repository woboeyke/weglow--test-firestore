export interface Certificate {
  orderId: string;
  email: string;
  naam: string;
  voornaam: string;
  rijksregisternummer: string;
  adres: string;
  bedrag: number;
  datum: string;
  status: CertificateStatus;
}

export enum CertificateStatus {
  Pending = "Pending",
  Approved = "Approved",
  Rejected = "Rejected",
}
