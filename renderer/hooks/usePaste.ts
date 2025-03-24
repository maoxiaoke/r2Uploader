import { useEffect } from "react";
import { v4 as uuidv4 } from 'uuid';

export const usePaste = (callback: (files: File[]) => Promise<void>) => {
  const onPaste = async (event: ClipboardEvent) => {
    event.preventDefault();

    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();

        // generate a unique file name
        const fileName = `${uuidv4()}.png`;
        const renamedFile = new File([file], fileName, { type: file.type });

        if (renamedFile) {
          try {
            await callback([renamedFile]);
          } catch (error) {
            console.error('上传失败:', error);
          }
        }
      }
    }
  };
  useEffect(() => {
    document.addEventListener('paste', onPaste);

    return () => {
      document.removeEventListener('paste', onPaste);
    };
  }, []);
};