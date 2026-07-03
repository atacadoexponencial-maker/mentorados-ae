export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      mentors: { Row: MentorRow; Insert: Omit<MentorRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<Database["public"]["Tables"]["mentors"]["Insert"]>; Relationships: [] };
      mentees: { Row: MenteeRow; Insert: Omit<MenteeRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<Database["public"]["Tables"]["mentees"]["Insert"]>; Relationships: [] };
      mentee_mentors: { Row: { mentee_id: string; mentor_id: string; created_at: string }; Insert: { mentee_id: string; mentor_id: string; created_at?: string }; Update: never; Relationships: [] };
      meetings: { Row: MeetingRow; Insert: Omit<MeetingRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<Database["public"]["Tables"]["meetings"]["Insert"]>; Relationships: [] };
      meeting_mentors: { Row: { meeting_id: string; mentor_id: string; source: "auto" | "manual" }; Insert: { meeting_id: string; mentor_id: string; source?: "auto" | "manual" }; Update: never; Relationships: [] };
      meeting_participations: { Row: ParticipationRow; Insert: Omit<ParticipationRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<Database["public"]["Tables"]["meeting_participations"]["Insert"]>; Relationships: [] };
      achievements: { Row: AchievementRow; Insert: Omit<AchievementRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<Database["public"]["Tables"]["achievements"]["Insert"]>; Relationships: [] };
      mentee_briefing: { Row: BriefingRow; Insert: Omit<BriefingRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<Database["public"]["Tables"]["mentee_briefing"]["Insert"]>; Relationships: [] };
      mentee_materials: { Row: MaterialRow; Insert: Omit<MaterialRow, "id" | "created_at" | "updated_at"> & { id?: string; created_at?: string; updated_at?: string }; Update: Partial<Database["public"]["Tables"]["mentee_materials"]["Insert"]>; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: { mentee_status: "active" | "paused" | "closed"; risk_level: "low" | "medium" | "high"; meeting_type: "individual" | "group"; meeting_front: "trafego" | "redes_sociais" | "comercial" | "estrategia"; briefing_status: "pending" | "filled"; mentor_link_source: "auto" | "manual"; material_type: "recording" | "summary" };
    CompositeTypes: Record<string, never>;
  };
}

export interface MentorRow { id: string; user_id: string | null; name: string; email: string; phone: string | null; color: string; front: "trafego" | "redes_sociais" | "comercial" | "estrategia" | null; created_at: string; updated_at: string }
export interface MenteeRow { id: string; name: string; company: string; role: string | null; joined_at: string; main_mentor_id: string | null; briefing: string; status: "active" | "paused" | "closed"; risk: "low" | "medium" | "high"; risk_reason: string; next_action: string; last_participation_at: string | null; accent: string; email: string | null; product: string | null; source_system: string; external_id: string | null; instagram_url: string | null; media_plan_url: string | null; folder_url: string | null; bonus: string | null; contract_end_at: string | null; source_data: Json; created_at: string; updated_at: string }
export interface MeetingRow { id: string; google_event_id: string | null; google_calendar_id: string | null; title: string; starts_at: string; ends_at: string; meet_url: string | null; type: "individual" | "group"; front: "trafego" | "redes_sociais" | "comercial" | "estrategia"; individual_mentee_id: string | null; attendance_recorded_at: string | null; general_note: string; created_at: string; updated_at: string }
export interface ParticipationRow { id: string; meeting_id: string; mentee_id: string; attended: boolean; engagement_score: number | null; evolution_score: number | null; note: string; recorded_by: string | null; created_at: string; updated_at: string }
export interface MaterialRow { id: string; mentee_id: string; meeting_id: string | null; type: "recording" | "summary"; title: string; drive_file_id: string; drive_url: string; happened_at: string; created_at: string; updated_at: string }
export interface AchievementRow { id: string; mentee_id: string; achieved_at: string; title: string; note: string; created_by: string | null; created_at: string; updated_at: string }
export interface BriefingRow {
  id: string;
  mentee_id: string;
  access_token: string | null;
  status: "pending" | "filled";
  import_review_pending: boolean;
  filled_at: string | null;
  brand_name: string | null;
  niche: string | null;
  founding_year: string | null;
  location: string | null;
  physical_stores: string | null;
  business_type: string | null;
  employees_count: string | null;
  marketing_team: string | null;
  sales_team: string | null;
  company_history: string | null;
  main_sales_channel: string | null;
  online_channels: string | null;
  first_purchase_policy: string | null;
  formality_policy: string | null;
  ideal_customer_profiles: string | null;
  primary_customer_profile: string | null;
  recurring_customers_avg: string | null;
  new_customers_avg: string | null;
  repurchase_behavior: string | null;
  base_sales_actions: string | null;
  new_sales_actions: string | null;
  collection_frequency: string | null;
  launch_strategy: string | null;
  marketing_difficulty: string | null;
  paid_traffic: string | null;
  whatsapp_leads_group: string | null;
  whatsapp_customers_group: string | null;
  acquisition_funnels: string | null;
  created_at: string;
  updated_at: string;
}
