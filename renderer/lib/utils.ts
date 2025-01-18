import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const shortenPath = (path: string, length: number = 24) => {
  if (!path) {
    return path;
  }

  if (path.length <= length) {
    return path;
  }

  const lengthToKeep = length / 2;

  return `${path.slice(0, lengthToKeep)}...${path.slice(
    path.length - lengthToKeep
  )}`;
};

export const getFiletype = (mime: string) => {
  if (mime.startsWith("text/")) {
    return "text";
  }

  if (mime.startsWith("image/")) {
    return "image";
  }

  if (mime.startsWith("audio/")) {
    return "audio";
  }

  if (mime.startsWith("font/")) {
    return "font";
  }

  if (mime.startsWith("video/")) {
    return "video";
  }

  if (mime === "application/json") {
    return "json";
  }

  if (mime === "application/pdf") {
    return "pdf";
  }

  if (mime === "application/zip") {
    return "zip";
  }

  return "unknown";
};
