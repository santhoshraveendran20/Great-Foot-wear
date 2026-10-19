import { ImagePlus, Loader2, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { errorMessage } from "@/lib/api"
import { useUploadAdminImageMutation } from "@/store/api/adminCatalogApi"

/** Uploads a single image to /admin/upload and returns its URL. */
export function ImageUpload({ value, onChange, folder, className = "size-24" }) {
  const [uploadImage, { isLoading: busy }] = useUploadAdminImageMutation()
  const upload = async (file) => {
    if (!file) return
    const fd = new FormData()
    fd.append("file", file)
    try {
      const data = await uploadImage({ folder, fd }).unwrap()
      onChange(data.url)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }
  return (
    <div className="flex items-center gap-3">
      <div className={`${className} relative overflow-hidden rounded-md border bg-muted`}>
        {value ? <img src={value} alt="" className="size-full object-cover" /> : <ImagePlus className="absolute inset-0 m-auto size-6 text-muted-foreground" />}
        {busy && <div className="absolute inset-0 grid place-items-center bg-background/70"><Loader2 className="size-5 animate-spin" /></div>}
      </div>
      <div className="flex flex-col gap-2">
        <Button type="button" variant="outline" size="sm" asChild>
          <label className="cursor-pointer">
            {value ? "Change image" : "Upload image"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </Button>
        {value && <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}><X /> Remove</Button>}
      </div>
    </div>
  )
}
