import { NextRequest } from "next/server";
import { getTypeformForm, simplifyTypeformFieldsFull } from "../../../../clients/typeform";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const formId =
      url.searchParams.get("form_id") ||
      process.env.NEXT_PUBLIC_TYPEFORM_FORM_ID ||
      "";

    if (!formId) {
      return new Response("Missing form_id (query) or NEXT_PUBLIC_TYPEFORM_FORM_ID", { status: 400 });
    }

    const form = await getTypeformForm(formId); // TYPEFORM_TOKEN z env
    const fields = simplifyTypeformFieldsFull(form);

    return Response.json({
      form: { id: form.id, title: form.title },
      hidden: form.hidden ?? [],
      count: fields.length,
      fields, // już spłaszczone + contact_info rozbite
    });
  } catch (e: any) {
    return new Response(`form-fields error: ${e?.message || e}`, { status: 500 });
  }
}
