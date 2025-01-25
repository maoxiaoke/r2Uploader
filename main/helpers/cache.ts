import path from "path";
import { ensureAppHome } from "./path";

const cache = ".cache";

export const getCachePath = () => {
  return path.join(ensureAppHome(), cache);
};
