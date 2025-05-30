import { useRef, useState } from "react";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CloudUpload,
  Loader,
  CircleCheckBig,
  CircleX,
  RotateCcw,
  RefreshCcwDot
} from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { shortenPath, prettifySize, getFiletype } from "../lib/utils";
import { SimpleUseTooltip } from '@/components/simple-use-tooltip';
import { FileTypeIcons } from "@/components/file-type-icons";
import { EditableConfettiCopyText } from "@/components/editable-confetti-copy-text";
import { usePaste } from "@/hooks/usePaste";

const FileStatus = ({
  status,
  message,
}: {
  status: "uploading" | "completed" | "error";
  message?: 'upload_failed' | 'file_exists' | string;
}) => {
  if (status === "uploading") {
    return (
      <span className="flex items-center gap-1">
        <Loader className="animate-spin" size={16} />
        Uploading...
      </span>
    );
  }

  if (status === "completed") {
    return (
      <span className="flex items-center gap-1">
        <CircleCheckBig size={16} className="text-primary" />
        Completed
      </span>
    );
  }

  const fileExists = message === 'file_exists';

  return (
    <span className="flex items-center gap-1">
      <CircleX size={16} className="text-red-500" />
      {fileExists ? 'File already exists' : 'Upload failed'}
    </span>
  );
};

const FileOperations = ({
  status,
  message,
  onRetry,
  onForceUpload,
}: {
  status: "uploading" | "completed" | "error";
  message?: 'upload_failed' | 'file_exists' | string;
  onRetry?: () => void;
  onForceUpload?: () => void;
}) => {
  if (status === 'error') {
    const fileExists = message === 'file_exists';

    return fileExists ? (
      <SimpleUseTooltip tips="Force upload">
        <RefreshCcwDot className="cursor-pointer text-red-500" size={18} onClick={onForceUpload} />
      </SimpleUseTooltip>
    ) : <SimpleUseTooltip tips="Retry">
      <RotateCcw className="cursor-pointer" size={18} onClick={onRetry} />
      </SimpleUseTooltip>
  }

  return null;
};
export interface UploadFile {
  file: File;
  newName?: string;
  progress: number;
  from: 'paste' | 'upload';
  status: "uploading" | "completed" | "error";
  message?: 'upload_failed' | 'file_exists' | string;
}

export function FileUpload({
  children,
  bucket,
  publicDomain,
  onClose,
}: {
  children: React.ReactNode;
  bucket: string;
  publicDomain: string;
  onClose?: (files: UploadFile[]) => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Array<UploadFile>>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const delimiterNames = router.query.delimiter as (string[] | undefined);

  const delimiter = delimiterNames ? delimiterNames.join('/') + '/' : '';

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const uploadFile = async (evt: React.ChangeEvent<HTMLInputElement> | File | FileList, {
    forceUpload = false,
    newName,
    fromPaste = false
  }: {
    forceUpload?: boolean;
    newName?: string;
    fromPaste?: boolean;
  } = {}) => {
    let savePath = null;
    const evtFiles = evt instanceof File ? [evt] : (evt instanceof FileList ? Array.from(evt) : evt.target.files);

    if (!evtFiles?.length) {
      return;
    }

    const handleSignleFileUpload = async (file) => {
      const idx = files.findIndex((f) => f.file.path === file.path);

      if (idx === -1) {
        setFiles((prev) => [
          {
            file,
            progress: 0,
            status: "uploading",
            from: fromPaste ? 'paste' : 'upload',
          },
          ...prev,
        ]);
      } else {
        setFiles((prev) => [
          ...prev.slice(0, idx),
          {
            ...prev[idx],
            status: "uploading",
            newName: newName,
          },
          ...prev.slice(idx + 1),
        ]);
      }

      const fileName = delimiter + (newName ?? file.name);

      try {
        if (!forceUpload) {
          const exists = await window.electron.ipc.invoke("cf-check-file-exists", {
            url: `${publicDomain}/${fileName}`,
          });

          if (exists) {
            throw new Error("file_exists");
          }
        }

        // if the file path is not set, download the file
        if (!file.path && !fromPaste) {
          const oldPath = delimiter + file.name;
          savePath = await window.electron.ipc.invoke("download-file", {
            url: `${publicDomain}/${oldPath}`,
          });
        }

        const rsp = await window.electron.ipc.invoke("cf-upload-file", {
          bucketName: bucket,
          fileName: fileName,
          filePath: savePath ?? file.path,
          fileType: file.type,
          fromPaste: fromPaste,
        });

        if (rsp.success) {
          setFiles((prev) =>
            prev.map((f) => {
              if (f.file.path === file.path) {
                return {
                  ...f,
                  status: "completed",
                };
              }

              return f;
            })
          );

          return;
        }

        throw new Error("upload_failed");
      } catch (error) {
        setFiles((prev) =>
          prev.map((f) => {
            if (f.file.path === file.path) {
              return {
                ...f,
                status: "error",
                message: error.message,
              };
            }

            return f;
          })
        );
      } finally {
        if (savePath) {
          window.electron.ipc.invoke("remove-cache-file", {
            path: savePath,
          });
        }
      }
    };

    Array.from(evtFiles).forEach(handleSignleFileUpload);
  };

  usePaste((files) => uploadFile(files[0], {
    fromPaste: true,
  }), {
    publicDomain,
    delimiter,
  });

  const handleOpenChange = (isOpen) => {
    if (!isOpen) {
      setFiles([]);
    }

    const successFiles = files.filter((f) => f.status === "completed");

    if (onClose && !isOpen && successFiles.length) {
      onClose(successFiles);
    }
  };

  const changeFileName = async (file: UploadFile, newName: string) => {
    const idx = files.findIndex((f) => f.file.path === file.file.path);

    if (idx === -1) {
      return;
    }

    const currentFile = files[idx];

    if (!(currentFile.status === "completed" || currentFile.status === "error")) {
      return;
    }

    const fileName = delimiter + currentFile.file.name;

    if (currentFile.status === "completed") {
      const exists = await window.electron.ipc.invoke("cf-check-file-exists", {
        url: `${publicDomain}/${fileName}`,
      });

      if (exists) {
        // delete the file
        window.electron.ipc.invoke("cf-delete-object", {
          bucket,
          object: fileName,
        });
      }
    }

    uploadFile(currentFile.file, { newName });
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      uploadFile(droppedFiles);
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader className="flex flex-row items-center">
          <div className="rounded-full border p-2 border-[#ccc]">
            <CloudUpload />
          </div>
          <div className="ml-4">
            <DialogTitle>Upload files</DialogTitle>
            <DialogDescription className="text-xs mt-1">
              Select files and upload to current bucket
            </DialogDescription>
          </div>
        </DialogHeader>

        <div
          id="dropzone"
          className="flex items-center justify-center w-full"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <label
            htmlFor="dropzone-file"
            className={`flex flex-col items-center justify-center w-full border-gray-300 border-dashed cursor-pointer dark:hover:bg-gray-800 dark:bg-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:hover:border-gray-500 dark:hover:bg-gray-600 border py-6 rounded-lg ${isDraggingOver ? 'bg-gray-100' : ''}`}
          >
            <div className="flex flex-col items-center justify-center">
              <CloudUpload />
              <div className="text-sm mt-4">
                Choose a file or drag & drop it here
              </div>

              <div className="text-secondary text-xs mt-1">
                File size should not exceed 300MB
              </div>

              <Button
                className="mt-6"
                type="button"
                size="sm"
                onClick={handleButtonClick}
              >
                Browse File
              </Button>
              <input
                id="dropzone-file"
                type="file"
                multiple
                className="hidden"
                ref={fileInputRef}
                onChange={uploadFile}
              />
            </div>
          </label>
        </div>

        {files?.length ? (
          <ScrollArea className="max-h-44">
            {files.map((file) => {
              const FileIcon = FileTypeIcons[getFiletype(file.file.type)]
              const fileName = file.newName ?? file.file.name;

              return (
                <div
                key={file.file.path}
                className="bg-gray-100 rounded-lg p-4 flex items-center justify-between mt-1"
              >
                <div className="flex items-center gap-4 text-sm">
                  <div className="text-2xl">

                  <FileIcon  />
                  </div>
                  <div>
                    <EditableConfettiCopyText text={shortenPath(fileName, 36)} shareUrl={`${publicDomain}/${fileName}`} canEdit={file.status === "completed" || file.status === "error"} onChangeName={(newName) => changeFileName(file, newName)} />
                    <div className="text-xs text-secondary mt-1 flex items-center gap-1">
                      {prettifySize(file.file.size)} ·{" "}
                      <FileStatus status={file.status} message={file.message} />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mr-2">
                  <FileOperations status={file.status} message={file.message} onRetry={() => uploadFile(file.file, { fromPaste: file.from === 'paste' })} onForceUpload={() => uploadFile(file.file, { forceUpload: true, fromPaste: file.from === 'paste' })} />
                </div>

              </div>
              )
            })}
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
