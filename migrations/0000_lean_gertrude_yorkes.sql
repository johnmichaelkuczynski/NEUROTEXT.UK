CREATE TABLE "analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"user_id" integer,
	"summary" text NOT NULL,
	"overall_score" integer NOT NULL,
	"overall_assessment" text NOT NULL,
	"dimensions" jsonb NOT NULL,
	"cognitive_patterns" jsonb,
	"writing_style" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"user_id" integer,
	"proof_effectiveness" integer NOT NULL,
	"claim_credibility" integer NOT NULL,
	"non_triviality" integer NOT NULL,
	"proof_quality" integer NOT NULL,
	"functional_writing" integer NOT NULL,
	"overall_case_score" integer NOT NULL,
	"detailed_assessment" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cognitive_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"writing_patterns" jsonb,
	"intellectual_interests" jsonb,
	"cognitive_style" jsonb,
	"learning_behavior" jsonb,
	"document_preferences" jsonb,
	"collaboration_style" jsonb,
	"conceptual_complexity" text,
	"attention_to_detail" integer,
	"creativity_index" integer,
	"systematic_thinking" integer,
	"average_session_length" integer,
	"total_documents_processed" integer,
	"preferred_ai_provider" text,
	"productivity_pattern" jsonb,
	"last_updated" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cognitive_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "coherence_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"coherence_mode" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text,
	"evaluation_result" jsonb,
	"state_after" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coherence_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"coherence_mode" text NOT NULL,
	"global_state" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparisons" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_a_id" integer NOT NULL,
	"document_b_id" integer NOT NULL,
	"analysis_a_id" integer NOT NULL,
	"analysis_b_id" integer NOT NULL,
	"user_id" integer,
	"comparison_results" jsonb NOT NULL,
	"improvement_suggestions" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" text NOT NULL,
	"amount" integer NOT NULL,
	"credits" integer NOT NULL,
	"transaction_type" text NOT NULL,
	"stripe_session_id" text,
	"stripe_payment_intent_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"original_content" text,
	"filename" text,
	"mime_type" text,
	"user_id" integer,
	"word_count" integer,
	"math_notation_count" integer,
	"complexity" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ai_probability" integer,
	"is_ai" boolean
);
--> statement-breakpoint
CREATE TABLE "hcc_chapters" (
	"id" serial PRIMARY KEY NOT NULL,
	"part_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"chapter_index" integer NOT NULL,
	"chapter_title" text,
	"original_text" text NOT NULL,
	"word_count" integer NOT NULL,
	"chapter_skeleton" jsonb,
	"compressed_part_skeleton" jsonb,
	"chapter_output" text,
	"chapter_delta" jsonb,
	"status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hcc_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"chapter_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_input_text" text NOT NULL,
	"chunk_input_words" integer NOT NULL,
	"chunk_output_text" text,
	"chunk_output_words" integer,
	"target_words" integer,
	"min_words" integer,
	"max_words" integer,
	"chunk_delta" jsonb,
	"conflicts_detected" jsonb,
	"status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hcc_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"title" text,
	"original_text" text NOT NULL,
	"word_count" integer NOT NULL,
	"structure_map" jsonb,
	"book_skeleton" jsonb,
	"final_output" text,
	"target_min_words" integer,
	"target_max_words" integer,
	"length_ratio" text,
	"length_mode" text,
	"status" text DEFAULT 'pending',
	"custom_instructions" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hcc_parts" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"part_index" integer NOT NULL,
	"part_title" text,
	"original_text" text NOT NULL,
	"word_count" integer NOT NULL,
	"part_skeleton" jsonb,
	"compressed_book_skeleton" jsonb,
	"part_output" text,
	"part_delta" jsonb,
	"status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intelligent_rewrites" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_document_id" integer NOT NULL,
	"rewritten_document_id" integer NOT NULL,
	"original_analysis_id" integer NOT NULL,
	"rewritten_analysis_id" integer NOT NULL,
	"user_id" integer,
	"provider" text NOT NULL,
	"custom_instructions" text,
	"original_score" integer NOT NULL,
	"rewritten_score" integer NOT NULL,
	"score_improvement" integer NOT NULL,
	"rewrite_report" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"stage" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_input_text" text,
	"chunk_output_text" text,
	"chunk_delta" jsonb,
	"target_words" integer,
	"actual_words" integer,
	"min_words" integer,
	"max_words" integer,
	"status" text DEFAULT 'pending',
	"retry_count" integer DEFAULT 0,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"original_text" text NOT NULL,
	"original_word_count" integer NOT NULL,
	"custom_instructions" text,
	"target_audience" text,
	"objective" text,
	"reconstruction_output" text,
	"objections_output" text,
	"responses_output" text,
	"bulletproof_output" text,
	"skeleton_1" jsonb,
	"skeleton_2" jsonb,
	"skeleton_3" jsonb,
	"skeleton_4" jsonb,
	"current_stage" integer DEFAULT 1,
	"stage_status" text DEFAULT 'pending',
	"total_stages" integer DEFAULT 4,
	"reconstruction_words" integer,
	"objections_words" integer,
	"responses_words" integer,
	"bulletproof_words" integer,
	"hc_check_results" jsonb,
	"hc_violations" jsonb,
	"hc_repair_attempts" integer DEFAULT 0,
	"stage1_start_time" timestamp,
	"stage1_end_time" timestamp,
	"stage2_start_time" timestamp,
	"stage2_end_time" timestamp,
	"stage3_start_time" timestamp,
	"stage3_end_time" timestamp,
	"stage4_start_time" timestamp,
	"stage4_end_time" timestamp,
	"hc_check_time" timestamp,
	"status" text DEFAULT 'pending',
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_objections" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"objection_index" integer NOT NULL,
	"claim_targeted" text,
	"claim_location" text,
	"objection_type" text,
	"objection_text" text,
	"severity" text,
	"initial_response" text,
	"enhanced_response" text,
	"enhancement_notes" text,
	"integrated_in_section" text,
	"integration_strategy" text,
	"integration_verified" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconstruction_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_input_text" text NOT NULL,
	"chunk_input_words" integer,
	"chunk_output_text" text,
	"actual_words" integer,
	"target_words" integer,
	"min_words" integer,
	"max_words" integer,
	"chunk_delta" jsonb,
	"conflicts_detected" jsonb,
	"status" text DEFAULT 'pending',
	"retry_count" integer DEFAULT 0,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconstruction_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"title" text,
	"original_text" text NOT NULL,
	"word_count" integer NOT NULL,
	"global_skeleton" jsonb,
	"final_output" text,
	"final_word_count" integer,
	"validation_result" jsonb,
	"status" text DEFAULT 'pending',
	"target_min_words" integer,
	"target_max_words" integer,
	"target_mid_words" integer,
	"length_ratio" real,
	"length_mode" text,
	"chunk_target_words" integer,
	"num_chunks" integer,
	"current_chunk" integer DEFAULT 0,
	"audience_parameters" text,
	"rigor_level" text,
	"custom_instructions" text,
	"error_message" text,
	"aborted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconstruction_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"run_type" text NOT NULL,
	"chunk_index" integer,
	"run_input" jsonb,
	"run_output" jsonb,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rewrite_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"input_text" text NOT NULL,
	"style_text" text,
	"content_mix_text" text,
	"custom_instructions" text,
	"selected_presets" jsonb,
	"provider" text NOT NULL,
	"chunks" jsonb,
	"selected_chunk_ids" jsonb,
	"mixing_mode" text,
	"output_text" text,
	"input_ai_score" integer,
	"output_ai_score" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stitch_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"conflicts" jsonb,
	"term_drift" jsonb,
	"missing_premises" jsonb,
	"redundancies" jsonb,
	"repair_plan" jsonb,
	"coherence_score" text,
	"final_validation" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_instructions" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"subcategory" text,
	"version" text DEFAULT '1.0',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"activity_type" text NOT NULL,
	"activity_data" jsonb,
	"document_id" integer,
	"session_duration" integer,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_credits" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" text NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"last_updated" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assessments" ADD CONSTRAINT "case_assessments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_assessments" ADD CONSTRAINT "case_assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cognitive_profiles" ADD CONSTRAINT "cognitive_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_document_a_id_documents_id_fk" FOREIGN KEY ("document_a_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_document_b_id_documents_id_fk" FOREIGN KEY ("document_b_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_analysis_a_id_analyses_id_fk" FOREIGN KEY ("analysis_a_id") REFERENCES "public"."analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_analysis_b_id_analyses_id_fk" FOREIGN KEY ("analysis_b_id") REFERENCES "public"."analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hcc_chapters" ADD CONSTRAINT "hcc_chapters_part_id_hcc_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."hcc_parts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hcc_chapters" ADD CONSTRAINT "hcc_chapters_document_id_hcc_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."hcc_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hcc_chunks" ADD CONSTRAINT "hcc_chunks_chapter_id_hcc_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."hcc_chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hcc_chunks" ADD CONSTRAINT "hcc_chunks_document_id_hcc_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."hcc_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hcc_documents" ADD CONSTRAINT "hcc_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hcc_parts" ADD CONSTRAINT "hcc_parts_document_id_hcc_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."hcc_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligent_rewrites" ADD CONSTRAINT "intelligent_rewrites_original_document_id_documents_id_fk" FOREIGN KEY ("original_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligent_rewrites" ADD CONSTRAINT "intelligent_rewrites_rewritten_document_id_documents_id_fk" FOREIGN KEY ("rewritten_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligent_rewrites" ADD CONSTRAINT "intelligent_rewrites_original_analysis_id_analyses_id_fk" FOREIGN KEY ("original_analysis_id") REFERENCES "public"."analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligent_rewrites" ADD CONSTRAINT "intelligent_rewrites_rewritten_analysis_id_analyses_id_fk" FOREIGN KEY ("rewritten_analysis_id") REFERENCES "public"."analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intelligent_rewrites" ADD CONSTRAINT "intelligent_rewrites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_chunks" ADD CONSTRAINT "pipeline_chunks_job_id_pipeline_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."pipeline_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_jobs" ADD CONSTRAINT "pipeline_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_objections" ADD CONSTRAINT "pipeline_objections_job_id_pipeline_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."pipeline_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconstruction_chunks" ADD CONSTRAINT "reconstruction_chunks_document_id_reconstruction_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."reconstruction_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconstruction_documents" ADD CONSTRAINT "reconstruction_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconstruction_runs" ADD CONSTRAINT "reconstruction_runs_document_id_reconstruction_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."reconstruction_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stitch_results" ADD CONSTRAINT "stitch_results_document_id_reconstruction_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."reconstruction_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activities" ADD CONSTRAINT "user_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_activities" ADD CONSTRAINT "user_activities_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credits" ADD CONSTRAINT "user_credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;