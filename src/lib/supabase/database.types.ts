
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "agent_events": {
                  Row: {
                    "actor": string,"details": Json | null,"id": string,"idempotency_key": string,"investigation_id": string,"is_synthetic": boolean,"message_id": string | null,"occurred_at": string,"recorded_at": string,"summary": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": string,"details"?: Json | null,"id"?: string,"idempotency_key": string,"investigation_id": string,"is_synthetic"?: boolean,"message_id"?: string | null,"occurred_at"?: string,"recorded_at"?: string,"summary": string,"type": string
                  }
                  Update: {
                    "actor"?: string,"details"?: Json | null,"id"?: string,"idempotency_key"?: string,"investigation_id"?: string,"is_synthetic"?: boolean,"message_id"?: string | null,"occurred_at"?: string,"recorded_at"?: string,"summary"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_events_investigation_id_fkey"
      columns: ["investigation_id"]
isOneToOne: false
      referencedRelation: "investigations"
      referencedColumns: ["id"]
    }
                  ]
                },"agent_findings": {
                  Row: {
                    "agent_id": string,"assessment": string,"created_at": string,"evidence_ids": (string)[],"explanation": string,"id": string,"investigation_id": string,"is_synthetic": boolean,"limitations": (string)[],"reason_codes": (string)[],"recommendation": Json | null,"recorded_at": string,"strength": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agent_id": string,"assessment": string,"created_at": string,"evidence_ids"?: (string)[],"explanation": string,"id": string,"investigation_id": string,"is_synthetic"?: boolean,"limitations"?: (string)[],"reason_codes": (string)[],"recommendation"?: Json | null,"recorded_at"?: string,"strength"?: string | null
                  }
                  Update: {
                    "agent_id"?: string,"assessment"?: string,"created_at"?: string,"evidence_ids"?: (string)[],"explanation"?: string,"id"?: string,"investigation_id"?: string,"is_synthetic"?: boolean,"limitations"?: (string)[],"reason_codes"?: (string)[],"recommendation"?: Json | null,"recorded_at"?: string,"strength"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_findings_investigation_id_fkey"
      columns: ["investigation_id"]
isOneToOne: false
      referencedRelation: "investigations"
      referencedColumns: ["id"]
    }
                  ]
                },"dev_smoke_records": {
                  Row: {
                    "created_at": string,"id": string,"notes": string | null,"owner_id": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"notes"?: string | null,"owner_id"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"notes"?: string | null,"owner_id"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"investigations": {
                  Row: {
                    "id": string,"is_synthetic": boolean,"latest_evidence_at": string | null,"opened_at": string,"owner_id": string | null,"public_latitude": number,"public_longitude": number,"public_precision_m": number,"report_count": number,"review_note": string | null,"review_outcome": string | null,"review_priority": string | null,"reviewed_at": string | null,"reviewed_by": string | null,"sources": (string)[],"status": string,"synthetic_scenario_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"is_synthetic"?: boolean,"latest_evidence_at"?: string | null,"opened_at"?: string,"owner_id"?: string | null,"public_latitude": number,"public_longitude": number,"public_precision_m": number,"report_count"?: number,"review_note"?: string | null,"review_outcome"?: string | null,"review_priority"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"sources"?: (string)[],"status"?: string,"synthetic_scenario_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "id"?: string,"is_synthetic"?: boolean,"latest_evidence_at"?: string | null,"opened_at"?: string,"owner_id"?: string | null,"public_latitude"?: number,"public_longitude"?: number,"public_precision_m"?: number,"report_count"?: number,"review_note"?: string | null,"review_outcome"?: string | null,"review_priority"?: string | null,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"sources"?: (string)[],"status"?: string,"synthetic_scenario_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"observations": {
                  Row: {
                    "coverage": Json | null,"evidence": Json | null,"id": string,"investigation_id": string,"is_synthetic": boolean,"latitude": number | null,"longitude": number | null,"observed_at": string | null,"provenance": NonNullable<Json>,"recorded_at": string,"retrieved_at": string,"source": string,"source_record_id": string | null,"source_state": string
                  }
                  ComputedFields: never
                  Insert: {
                    "coverage"?: Json | null,"evidence"?: Json | null,"id"?: string,"investigation_id": string,"is_synthetic"?: boolean,"latitude"?: number | null,"longitude"?: number | null,"observed_at"?: string | null,"provenance": NonNullable<Json>,"recorded_at"?: string,"retrieved_at"?: string,"source": string,"source_record_id"?: string | null,"source_state": string
                  }
                  Update: {
                    "coverage"?: Json | null,"evidence"?: Json | null,"id"?: string,"investigation_id"?: string,"is_synthetic"?: boolean,"latitude"?: number | null,"longitude"?: number | null,"observed_at"?: string | null,"provenance"?: NonNullable<Json>,"recorded_at"?: string,"retrieved_at"?: string,"source"?: string,"source_record_id"?: string | null,"source_state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "observations_investigation_id_fkey"
      columns: ["investigation_id"]
isOneToOne: false
      referencedRelation: "investigations"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"report_media": {
                  Row: {
                    "created_at": string,"id": string,"is_synthetic": boolean,"mime_type": string,"object_path": string,"owner_id": string | null,"size_bytes": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id": string,"is_synthetic"?: boolean,"mime_type": string,"object_path": string,"owner_id"?: string | null,"size_bytes": number
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_synthetic"?: boolean,"mime_type"?: string,"object_path"?: string,"owner_id"?: string | null,"size_bytes"?: number
                  }
                  Relationships: [
                    
                  ]
                },"reports": {
                  Row: {
                    "client_request_id": string,"created_at": string,"description": string,"id": string,"investigation_id": string,"is_synthetic": boolean,"latitude": number,"location_uncertainty_m": number,"longitude": number,"media_id": string | null,"observed_at": string,"owner_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "client_request_id": string,"created_at"?: string,"description": string,"id"?: string,"investigation_id": string,"is_synthetic"?: boolean,"latitude": number,"location_uncertainty_m": number,"longitude": number,"media_id"?: string | null,"observed_at": string,"owner_id"?: string | null
                  }
                  Update: {
                    "client_request_id"?: string,"created_at"?: string,"description"?: string,"id"?: string,"investigation_id"?: string,"is_synthetic"?: boolean,"latitude"?: number,"location_uncertainty_m"?: number,"longitude"?: number,"media_id"?: string | null,"observed_at"?: string,"owner_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_investigation_id_fkey"
      columns: ["investigation_id"]
isOneToOne: false
      referencedRelation: "investigations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_media_id_fkey"
      columns: ["media_id"]
isOneToOne: true
      referencedRelation: "report_media"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            [_ in never]: never
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
