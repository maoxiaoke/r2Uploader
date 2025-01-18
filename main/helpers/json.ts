import fs from "fs";

export const safeParse = (json: string, defaultOuput = {}) => {
  if (!fs.existsSync(json)) {
    return defaultOuput;
  }

  const content = fs.readFileSync(json, "utf-8");

  try {
    return JSON.parse(content);
  } catch (error) {
    return defaultOuput;
  }
};
