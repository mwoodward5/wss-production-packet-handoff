export { business, services } from "./bridge";
export type ServiceIcon = "HardHat" | "Home" | "Hammer" | "Frame" | "PaintRoller" | "Layers" | "SquareStack" | "Grid3x3" | "Wrench" | "Building2";
export type Service = {slug:string;name:string;short:string;icon:ServiceIcon};
