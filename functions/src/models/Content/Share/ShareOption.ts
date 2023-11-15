export interface ShareOption {
  icon: string;
  title: string;
  url: string;
}

export const defaultShareOption: ShareOption = {
  icon: "",
  title: "",
  url: "",
};

export const defaultShareOptions: ShareOption[] = [defaultShareOption];
