// @ts-ignore
import { imageSizeFromFile } from 'image-size/fromFile';
import type { CoverImage } from '../../shared/types';

export const getCover = async (filePath: string, fileType: string): Promise<CoverImage | null> => {
  if (fileType.startsWith('image/')) {
    const size = await imageSizeFromFile(filePath);

    return {
      height: size.height,
      width: size.width,
    }
  }

  return null;
}