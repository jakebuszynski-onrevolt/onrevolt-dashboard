export interface ReportProject {
  id: number;
  name: string;
  code: string;
  created_at: string;
}

export interface ReportPage {
  id: number;
  project_id: number;
  page_index: number;
  image_url: string;
  natural_width: number;
  natural_height: number;
}

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "computed"
  | "radioGroup"
  | "checkboxGroup";

export type FieldSource = "pipedrive" | "manual" | "computed";

export interface ReportField {
  id: number;
  project_id: number;
  page_id: number;
  type: FieldType;
  name: string;
  source: FieldSource;
  pipedrive_key?: string;
  expr?: string;
  x_percent: number;
  y_percent: number;
  w_percent: number;
  h_percent: number;
  font_family: string;
  font_size: number;
  font_weight: string;
  color: string;
  text_align: "left" | "center" | "right";
  z_index: number;
  meta_json?: Record<string, any>;
}

export interface ReportFieldOption {
  id: number;
  field_id: number;
  value: string;
  label?: string;
  x_percent: number;
  y_percent: number;
}

export interface Report {
  id: number;
  project_id: number;
  subject_id?: string;
  data_json: Record<string, any>;
  updated_at: string;
}
