import { Translation } from "../Translation";

export interface Mail {
  sendEmailOnPayment: boolean;
  emailHtml: Translation[];
  emailSubject: Translation[];

  sendCertificateEmailOnPayment: boolean;
  certificateEmailHtml: Translation[];
  certificateEmailSubject: Translation[];
}

export const defaultMail: Mail = {
  sendEmailOnPayment: false,
  emailHtml: [],
  emailSubject: [],
  sendCertificateEmailOnPayment: false,
  certificateEmailHtml: [],
  certificateEmailSubject: [],
};
