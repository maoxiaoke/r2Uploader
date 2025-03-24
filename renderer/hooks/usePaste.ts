import { useEffect } from "react";
import { v4 as uuidv4 } from 'uuid';

export const usePaste = (callback: (files: File[]) => Promise<void>, {
  publicDomain,
  delimiter,
}: {
  publicDomain: string;
  delimiter: string;
}) => {
  const onPaste = async (event: ClipboardEvent) => {
    event.preventDefault();

    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.indexOf('image') !== -1) {
        let file = item.getAsFile();

        const fileName = delimiter + file.name;

        const exists = await window.electron.ipc.invoke("cf-check-file-exists", {
          url: `${publicDomain}/${fileName}`,
        });

        if (exists) {
          // generate a unique file name
          const uniqueFileName = `${uuidv4()}.${file.type.split('/')[1]}`;
          file = new File([file], uniqueFileName, { type: file.type });
        }

        if (file) {
          try {
            await callback([file]);
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