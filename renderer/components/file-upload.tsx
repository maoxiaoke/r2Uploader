import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CloudUpload,
  FileType,
  Loader,
  CircleCheckBig,
  CircleX,
} from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { shortenPath } from "../lib/utils";

const FileStatus = ({
  status,
}: {
  status: "uploading" | "completed" | "error";
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

  return (
    <span className="flex items-center gap-1">
      <CircleX size={16} className="text-red-500" />
      Upload failed
    </span>
  );
};

export interface UploadFile {
  file: File;
  progress: number;
  status: "uploading" | "completed" | "error";
}

export function FileUpload({
  children,
  bucket,
  onClose,
}: {
  children: React.ReactNode;
  bucket: string;
  onClose?: (files: UploadFile[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Array<UploadFile>>([]);

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const uploadFile = async (evt: React.ChangeEvent<HTMLInputElement>) => {
    const evtFiles = evt.target.files;

    if (!evtFiles?.length) {
      return;
    }

    const handleSignleFileUpload = async (file) => {
      const idx = files.find((f) => f.file.path === file.path);

      if (!idx) {
        setFiles((prev) => [
          {
            file,
            progress: 0,
            status: "uploading",
          },
          ...prev,
        ]);
      }

      try {
        const rsp = await window.electron.ipc.invoke("cf-upload-file", {
          bucketName: bucket,
          fileName: file.name,
          filePath: file.path,
          fileType: file.type,
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

        throw new Error("Upload failed");
      } catch (error) {
        setFiles((prev) =>
          prev.map((f) => {
            if (f.file.path === file.path) {
              return {
                ...f,
                status: "error",
              };
            }

            return f;
          })
        );
      }
    };

    Array.from(evtFiles).forEach(handleSignleFileUpload);
  };

  const handleOpenChange = (isOpen) => {
    if (!isOpen) {
      setFiles([]);
    }

    const successFiles = files.filter((f) => f.status === "completed");

    if (onClose && !isOpen && successFiles.length) {
      onClose(successFiles);
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

        <div className="flex items-center justify-center w-full">
          <label
            htmlFor="dropzone-file"
            className="flex flex-col items-center justify-center w-full border-gray-300 border-dashed cursor-pointer dark:hover:bg-gray-800 dark:bg-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:hover:border-gray-500 dark:hover:bg-gray-600 border py-6 rounded-lg"
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
            {files.map((file) => (
              <div
                key={file.file.path}
                className="bg-gray-100 rounded-lg p-4 flex items-center justify-between mt-1"
              >
                <div className="flex items-center gap-4 text-sm">
                  <FileType />
                  <div>
                    <div>{shortenPath(file.file.name, 36)}</div>
                    <div className="text-xs text-secondary mt-1 flex items-center gap-1">
                      {file.file.size} bytes ·{" "}
                      <FileStatus status={file.status} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
