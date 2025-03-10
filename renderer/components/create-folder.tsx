import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/Input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useState } from "react";
import { Loader2 } from "lucide-react";

export interface CreateFolderProps {
  bucketName: string;
  delimiter: string;
  publicDomain: string;
  children: React.ReactNode;
  onSuccess: () => void;
  onError: (error: string) => void;
}

const defaultFileName = 'default.txt';

export function CreateFolder({ children, bucketName, delimiter, publicDomain, onSuccess, onError }: CreateFolderProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const create = async () => {
    if (!name) {
      return;
    }

    setLoading(true);

    const folderPath = delimiter ? `${delimiter}/${name}` : name;

    try {
      const exists = await window.electron.ipc.invoke("cf-check-file-exists", {
        url: `${publicDomain}/${folderPath}/${defaultFileName}`,
      });

      if (exists) {
        throw new Error("folder_already_exists");
      }

      await window.electron.ipc.invoke("cf-create-folder", {
        bucketName,
        fileName: `${folderPath}/${defaultFileName}`,
      });
      setOpen(false);
      onSuccess();
    } catch (error) {
      onError(error?.message ?? "unknown_error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create a new folder</DialogTitle>
          <DialogDescription className="text-xs mt-1">
            The folder will be created in the current path of the bucket.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-start gap-1.5">
          <label className="text-sm">Folder name</label>
          <span className="text-xs text-secondary">
            Make sure the folder name is unique. Use hyphen to separate words.
          </span>
          <Input
            className="focus:bg-white focus:bg-opacity-80 bg-white bg-opacity-60 w-80"
            value={name}
            placeholder="eg. my-blog-folder"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>

        <DialogFooter>
          <Button type="submit" onClick={create} disabled={loading}>
            {loading ? <Loader2 className="animate-spin ml-2" /> : null} Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
