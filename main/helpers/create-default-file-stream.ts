import { Readable } from 'stream';

export const createDefaultFileStream = async () => {
  const content = `This folder created at ${new Date().toISOString()}`;

  const contentStream = new Readable({
    read() {
      this.push(content);
      this.push(null);
    }
  });

  return contentStream;
};