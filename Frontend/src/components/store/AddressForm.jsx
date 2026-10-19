import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { errorMessage } from "@/lib/api"
import { INDIAN_STATES } from "@/lib/utils"
import { useSaveAddressMutation } from "@/store/api/commonApi"

const schema = z.object({
  name: z.string().trim().min(2, "Enter the receiver's name"),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"),
  line1: z.string().trim().min(3, "Enter house / street"),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(2, "Enter city"),
  state: z.string().min(2, "Select state"),
  pincode: z.string().regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit PIN code"),
  is_default: z.boolean().default(false),
})

const EMPTY = { name: "", mobile: "", line1: "", line2: "", city: "", state: "Tamil Nadu", pincode: "", is_default: false }

/** UM-10 address add / edit (6-digit PIN validation). */
export function AddressDialog({ open, onOpenChange, address, onSaved }) {
  const [saveAddress] = useSaveAddressMutation()
  const form = useForm({ resolver: zodResolver(schema), values: address ? { ...EMPTY, ...address, line2: address.line2 || "" } : EMPTY })
  const onSubmit = async (v) => {
    try {
      const body = { ...v, line2: v.line2 || null }
      // PUT when editing, POST when new; refreshes the address list
      const data = await saveAddress({ ...body, id: address?.id }).unwrap()
      onSaved?.(data)
      onOpenChange(false)
    } catch (e) {
      form.setError("root", { message: errorMessage(e) })
    }
  }
  const text = (name, label, props = {}) => (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl><Input {...field} {...props} /></FormControl>
        <FormMessage />
      </FormItem>
    )} />
  )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{address?.id ? "Edit address" : "Add a new address"}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2">
            {form.formState.errors.root && <p className="text-sm text-destructive sm:col-span-2">{form.formState.errors.root.message}</p>}
            {text("name", "Full name", { autoComplete: "name" })}
            {text("mobile", "Mobile number", { inputMode: "numeric", maxLength: 10 })}
            <div className="sm:col-span-2">{text("line1", "House no., building, street", { autoComplete: "address-line1" })}</div>
            <div className="sm:col-span-2">{text("line2", "Area, landmark (optional)", { autoComplete: "address-line2" })}</div>
            {text("city", "City", { autoComplete: "address-level2" })}
            {text("pincode", "PIN code", { inputMode: "numeric", maxLength: 6, autoComplete: "postal-code" })}
            <FormField control={form.control} name="state" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>State</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger></FormControl>
                  <SelectContent>{INDIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="is_default" render={({ field }) => (
              <FormItem className="flex items-center gap-2 space-y-0 sm:col-span-2">
                <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                <FormLabel className="font-normal">Make this my default address</FormLabel>
              </FormItem>
            )} />
            <Button type="submit" className="sm:col-span-2" disabled={form.formState.isSubmitting}>Save address</Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
