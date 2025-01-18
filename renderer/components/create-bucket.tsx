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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { Loader2 } from "lucide-react";

export function CreateBucket({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("apac");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const create = async () => {
    if (!name) {
      return;
    }

    setLoading(true);

    await window.electron.ipc.invoke("cf-create-bucket", {
      name,
      location,
    });

    setLoading(false);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create a new bucket</DialogTitle>
          <DialogDescription className="text-xs mt-1">
            Select files and upload to current bucket
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-start gap-1.5">
          <label className="text-sm">Bucket name</label>
          <span className="text-xs text-secondary">
            Bucket name must be between 3-63 characters long.
          </span>
          <Input
            className="focus:bg-white focus:bg-opacity-80 bg-white bg-opacity-60 w-80"
            value={name}
            placeholder="eg. my-bucket"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>

        <div className="flex flex-col items-start gap-1.5">
          <label className="text-sm">Location</label>
          <Select value={location} onValueChange={setLocation}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="apac">Asia-Pacific (APAC)</SelectItem>
                <SelectItem value="eeur">Eastern Europe (EEUR)</SelectItem>
                <SelectItem value="enam">
                  Eastern North America (ENAM)
                </SelectItem>
                <SelectItem value="oc">Oceania (OC)</SelectItem>
                <SelectItem value="weur">Western Europe (WEUR)</SelectItem>
                <SelectItem value="wnam">
                  Western North America (WNAM)
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="text-xs text-secondary">
          Buckets are publicly accessible by default.
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
