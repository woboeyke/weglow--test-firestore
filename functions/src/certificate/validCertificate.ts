import { Certificate } from "../models/Certificate";

export const validCertificate = (certificate: Certificate) => {
  if (!certificate) {
    throw new Error("Certificate cannot be null");
  }

  const keys = Object.keys(certificate);

  for (const key of keys) {
    if (certificate[key as keyof Certificate] === null || certificate[key as keyof Certificate] === undefined) {
      throw new Error(`${key} is required`);
    }
  }

  if (certificate.naam.length > 50) {
    throw new Error("Naam cannot be more than 50 characters");
  }

  if (certificate.voornaam.length > 50) {
    throw new Error("Voornaam cannot be more than 50 characters");
  }

  if (certificate.adres.length > 200) {
    throw new Error("Adres cannot be more than 200 characters");
  }
};
