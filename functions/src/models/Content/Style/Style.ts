import { Colors, defaultColors } from "./Color";
import { Font, defaultFont } from "./Font";

export interface Style {
  font: Font;
  colors: Colors;
  customCss: string;
  textColorPrimary: string;
  textColorSecondary: string;
  showBlackWeglowLogo: boolean;
}

export const defaultStyle: Style = {
  font: defaultFont,
  colors: defaultColors,
  customCss: "",
  textColorPrimary: "#ffffff",
  textColorSecondary: "#000000",
  showBlackWeglowLogo: true,
};
