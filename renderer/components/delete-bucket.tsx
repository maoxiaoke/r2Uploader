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

export function DeleteBucket({
  children,
  bucketName,
  onError,
}: {
  children: React.ReactNode;
  bucketName: string;
  onError: (errMsg: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const deleteBucket = async () => {
    setLoading(true);

    const resp = await window.electron.ipc.invoke("cf-delete-bucket", {
      name: bucketName,
    });

    if (!resp.success) {
      const code = resp?.errors?.[0]?.code;

      if (code === 10008) {
        onError("The bucket you tried to delete is not empty");
      }
    }

    setLoading(false);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Remove this bucket?</DialogTitle>
          <DialogDescription className="text-sm mt-2">
            This action removes the{" "}
            <span className="font-bold text-red-600">{bucketName}</span> bucket
            and all its contents. And it will also delete all the remote files.
            <br />
            <br />
            This action is{" "}
            <span className="font-bold text-red-600">irreversible</span>.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="submit"
            onClick={deleteBucket}
            disabled={loading}
            variant="destructive"
          >
            {loading ? <Loader2 className="animate-spin ml-2" /> : null} Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
