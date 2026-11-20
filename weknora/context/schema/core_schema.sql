--
-- PostgreSQL database dump
--

\restrict vJlQnwmfd4OffjFWFj1eGfI2dMRM7OtP2QK0DxwhdmVbsRFv4Me6XlPc9MMJbkM

-- Dumped from database version 17.9 (Debian 17.9-1.pgdg13+1)
-- Dumped by pg_dump version 17.9 (Debian 17.9-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: chunks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chunks (
    id character varying(36) DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id integer NOT NULL,
    knowledge_base_id character varying(36) NOT NULL,
    knowledge_id character varying(36) NOT NULL,
    content text NOT NULL,
    chunk_index integer NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    start_at integer NOT NULL,
    end_at integer NOT NULL,
    pre_chunk_id character varying(36),
    next_chunk_id character varying(36),
    chunk_type character varying(20) DEFAULT 'text'::character varying NOT NULL,
    parent_chunk_id character varying(36),
    image_info text,
    relation_chunks jsonb,
    indirect_relation_chunks jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    metadata jsonb,
    tag_id character varying(36),
    status integer DEFAULT 0 NOT NULL,
    content_hash character varying(64),
    flags integer DEFAULT 1 NOT NULL,
    seq_id bigint DEFAULT nextval('public.chunks_seq_id_seq'::regclass) NOT NULL,
    video_info text,
    source_content text DEFAULT ''::text NOT NULL,
    content_revision integer DEFAULT 0 NOT NULL,
    index_status character varying(16) DEFAULT 'ready'::character varying NOT NULL,
    last_editor_id character varying(64) DEFAULT ''::character varying NOT NULL,
    context_header text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.chunks OWNER TO postgres;

--
-- Name: COLUMN chunks.video_info; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.chunks.video_info IS 'Video information in JSON format: {"url": string, "frame_count": int, "has_vlm_analysis": bool, "has_asr": bool, "video_summary": string, "asr_text": string, "frame_descriptions": string[]}';


--
-- Name: knowledge_bases; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.knowledge_bases (
    id character varying(36) DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    tenant_id integer NOT NULL,
    chunking_config jsonb DEFAULT '{"chunk_size": 512, "chunk_overlap": 50, "split_markers": ["\n\n", "\n", "。"], "keep_separator": true}'::jsonb NOT NULL,
    image_processing_config jsonb DEFAULT '{"model_id": "", "enable_multimodal": false}'::jsonb NOT NULL,
    embedding_model_id character varying(64) NOT NULL,
    summary_model_id character varying(64) NOT NULL,
    cos_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    vlm_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    extract_config jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    is_temporary boolean DEFAULT false NOT NULL,
    type character varying(32) DEFAULT 'document'::character varying NOT NULL,
    faq_config jsonb,
    question_generation_config jsonb,
    storage_provider_config jsonb,
    is_pinned boolean DEFAULT false NOT NULL,
    pinned_at timestamp with time zone,
    asr_config jsonb,
    vector_store_id character varying(36),
    wiki_config jsonb,
    indexing_strategy jsonb,
    creator_id character varying(36),
    storage_backend_id character varying(36),
    auto_tag_config jsonb
);


ALTER TABLE public.knowledge_bases OWNER TO postgres;

--
-- Name: COLUMN knowledge_bases.is_temporary; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.knowledge_bases.is_temporary IS 'Whether this knowledge base is temporary (ephemeral) and should be hidden from UI';


--
-- Name: COLUMN knowledge_bases.storage_provider_config; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.knowledge_bases.storage_provider_config IS 'Storage provider config for this KB. Only stores provider name; credentials come from tenant StorageEngineConfig.';


--
-- Name: COLUMN knowledge_bases.asr_config; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.knowledge_bases.asr_config IS 'ASR (Automatic Speech Recognition) configuration: {"enabled": bool, "model_id": string, "language": string}';


--
-- Name: COLUMN knowledge_bases.vector_store_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.knowledge_bases.vector_store_id IS 'References vector_stores.id. NULL means tenant default (env store derived from RETRIEVE_DRIVER). Immutable after creation (enforced at ORM and service layer). No FK by design.';


--
-- Name: COLUMN knowledge_bases.wiki_config; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.knowledge_bases.wiki_config IS 'Wiki configuration: {"auto_ingest": bool, "synthesis_model_id": string, "wiki_language": string, "max_pages_per_ingest": int}';


--
-- Name: COLUMN knowledge_bases.indexing_strategy; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.knowledge_bases.indexing_strategy IS 'Indexing pipelines strategy: {"vector_enabled": bool, "keyword_enabled": bool, "wiki_enabled": bool, "graph_enabled": bool}';


--
-- Name: knowledge_tag_relations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.knowledge_tag_relations (
    knowledge_id character varying(36) NOT NULL,
    tag_id character varying(36) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.knowledge_tag_relations OWNER TO postgres;

--
-- Name: knowledge_tags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.knowledge_tags (
    id character varying(36) NOT NULL,
    tenant_id integer NOT NULL,
    knowledge_base_id character varying(36) NOT NULL,
    name character varying(128) NOT NULL,
    color character varying(32),
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    seq_id bigint DEFAULT nextval('public.knowledge_tags_seq_id_seq'::regclass) NOT NULL
);


ALTER TABLE public.knowledge_tags OWNER TO postgres;

--
-- Name: knowledges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.knowledges (
    id character varying(36) DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id integer NOT NULL,
    knowledge_base_id character varying(36) NOT NULL,
    type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    source character varying(2048) NOT NULL,
    parse_status character varying(50) DEFAULT 'unprocessed'::character varying NOT NULL,
    enable_status character varying(50) DEFAULT 'enabled'::character varying NOT NULL,
    embedding_model_id character varying(64),
    file_name character varying(255),
    file_type character varying(50),
    file_size bigint,
    file_path text,
    file_hash character varying(64),
    storage_size bigint DEFAULT 0 NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    processed_at timestamp with time zone,
    error_message text,
    deleted_at timestamp with time zone,
    summary_status character varying(32) DEFAULT 'none'::character varying,
    last_faq_import_result json,
    channel character varying(50) DEFAULT 'web'::character varying NOT NULL,
    pending_subtasks_count integer DEFAULT 0 NOT NULL,
    custom_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    folder_path character varying(1024) DEFAULT ''::character varying NOT NULL
);


ALTER TABLE public.knowledges OWNER TO postgres;

--
-- Name: COLUMN knowledges.channel; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.knowledges.channel IS 'Source channel of the knowledge: web, api, browser_extension, wechat, etc.';


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.organizations (
    id character varying(36) DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    owner_id character varying(36) NOT NULL,
    invite_code character varying(32),
    require_approval boolean DEFAULT false,
    invite_code_expires_at timestamp with time zone,
    invite_code_validity_days smallint DEFAULT 7 NOT NULL,
    avatar character varying(512) DEFAULT ''::character varying,
    searchable boolean DEFAULT false NOT NULL,
    member_limit integer DEFAULT 50 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    owner_tenant_id bigint NOT NULL
);


ALTER TABLE public.organizations OWNER TO postgres;

--
-- Name: TABLE organizations; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.organizations IS 'Organizations for cross-tenant collaboration';


--
-- Name: COLUMN organizations.owner_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.organizations.owner_id IS 'User ID of the organization owner';


--
-- Name: COLUMN organizations.invite_code; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.organizations.invite_code IS 'Unique invitation code for joining the organization';


--
-- Name: COLUMN organizations.require_approval; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.organizations.require_approval IS 'Whether joining this organization requires admin approval';


--
-- Name: COLUMN organizations.invite_code_expires_at; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.organizations.invite_code_expires_at IS 'When the current invite code expires; NULL means no expiry (legacy)';


--
-- Name: COLUMN organizations.invite_code_validity_days; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.organizations.invite_code_validity_days IS 'Invite link validity in days: 0=never expire, 1/7/30 days';


--
-- Name: COLUMN organizations.searchable; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.organizations.searchable IS 'When true, space appears in search and can be joined by org ID';


--
-- Name: COLUMN organizations.member_limit; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.organizations.member_limit IS 'Max members allowed; 0 means no limit';


--
-- Name: COLUMN organizations.owner_tenant_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.organizations.owner_tenant_id IS 'Plan 3 (#1303): owning tenant; cannot be removed/downgraded from OTM.';


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tenants (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    retriever_engines jsonb DEFAULT '[]'::jsonb NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying,
    business character varying(255) NOT NULL,
    storage_quota bigint DEFAULT '10737418240'::bigint NOT NULL,
    storage_used bigint DEFAULT 0 NOT NULL,
    agent_config jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    context_config jsonb,
    conversation_config jsonb,
    web_search_config jsonb,
    parser_engine_config jsonb,
    storage_engine_config jsonb,
    chat_history_config jsonb,
    retrieval_config jsonb,
    credentials jsonb,
    api_principal_config jsonb,
    default_storage_backend_id character varying(36)
);


ALTER TABLE public.tenants OWNER TO postgres;

--
-- Name: COLUMN tenants.agent_config; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tenants.agent_config IS 'Tenant-level agent configuration in JSON format';


--
-- Name: COLUMN tenants.context_config; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tenants.context_config IS 'Global Context configuration for this tenant (default for all sessions)';


--
-- Name: COLUMN tenants.conversation_config; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tenants.conversation_config IS 'Global Conversation configuration for this tenant (default for normal mode sessions)';


--
-- Name: COLUMN tenants.web_search_config; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tenants.web_search_config IS 'Web search configuration for the tenant';


--
-- Name: COLUMN tenants.parser_engine_config; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tenants.parser_engine_config IS 'Parser engine overrides (mineru_endpoint, mineru_api_key, etc.); takes precedence over env when parsing';


--
-- Name: COLUMN tenants.storage_engine_config; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tenants.storage_engine_config IS 'Storage engine parameters for Local, MinIO, COS; used for document/file storage and docreader';


--
-- Name: COLUMN tenants.credentials; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.tenants.credentials IS 'Third-party provider credentials (e.g. WeKnoraCloud AppID/AppSecret); encrypted at application level';


--
-- Name: tenants_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tenants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tenants_id_seq OWNER TO postgres;

--
-- Name: tenants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tenants_id_seq OWNED BY public.tenants.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id character varying(36) DEFAULT public.uuid_generate_v4() NOT NULL,
    username character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    avatar character varying(500),
    tenant_id integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    can_access_all_tenants boolean DEFAULT false NOT NULL,
    preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_system_admin boolean DEFAULT false NOT NULL
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.users IS 'User accounts in the system';


--
-- Name: COLUMN users.id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.id IS 'Unique identifier of the user';


--
-- Name: COLUMN users.username; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.username IS 'Username of the user';


--
-- Name: COLUMN users.email; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.email IS 'Email address of the user';


--
-- Name: COLUMN users.password_hash; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.password_hash IS 'Hashed password of the user';


--
-- Name: COLUMN users.avatar; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.avatar IS 'Avatar URL of the user';


--
-- Name: COLUMN users.tenant_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.tenant_id IS 'Tenant ID that the user belongs to';


--
-- Name: COLUMN users.is_active; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.is_active IS 'Whether the user is active';


--
-- Name: COLUMN users.preferences; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.preferences IS 'Per-user JSON preferences (memory toggle, future UI knobs)';


--
-- Name: COLUMN users.is_system_admin; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.users.is_system_admin IS 'Whether the user is a system administrator (independent of tenant roles)';


--
-- Name: tenants id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenants ALTER COLUMN id SET DEFAULT nextval('public.tenants_id_seq'::regclass);


--
-- Name: chunks chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chunks
    ADD CONSTRAINT chunks_pkey PRIMARY KEY (id);


--
-- Name: knowledge_bases knowledge_bases_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.knowledge_bases
    ADD CONSTRAINT knowledge_bases_pkey PRIMARY KEY (id);


--
-- Name: knowledge_tag_relations knowledge_tag_relations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.knowledge_tag_relations
    ADD CONSTRAINT knowledge_tag_relations_pkey PRIMARY KEY (knowledge_id, tag_id);


--
-- Name: knowledge_tags knowledge_tags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.knowledge_tags
    ADD CONSTRAINT knowledge_tags_pkey PRIMARY KEY (id);


--
-- Name: knowledges knowledges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.knowledges
    ADD CONSTRAINT knowledges_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_chunks_chunk_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chunks_chunk_type ON public.chunks USING btree (chunk_type);


--
-- Name: idx_chunks_content_hash; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chunks_content_hash ON public.chunks USING btree (content_hash);


--
-- Name: idx_chunks_kb_tenant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chunks_kb_tenant ON public.chunks USING btree (knowledge_base_id, tenant_id);


--
-- Name: idx_chunks_knowledge_enabled; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chunks_knowledge_enabled ON public.chunks USING btree (knowledge_id, is_enabled, deleted_at);


--
-- Name: idx_chunks_parent_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chunks_parent_id ON public.chunks USING btree (parent_chunk_id);


--
-- Name: idx_chunks_seq_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_chunks_seq_id ON public.chunks USING btree (seq_id);


--
-- Name: idx_chunks_tag; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chunks_tag ON public.chunks USING btree (tag_id);


--
-- Name: idx_chunks_tenant_kg; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_chunks_tenant_kg ON public.chunks USING btree (tenant_id, knowledge_id);


--
-- Name: idx_knowledge_bases_storage_backend; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_knowledge_bases_storage_backend ON public.knowledge_bases USING btree (tenant_id, storage_backend_id);


--
-- Name: idx_knowledge_bases_tenant_creator; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_knowledge_bases_tenant_creator ON public.knowledge_bases USING btree (tenant_id, creator_id);


--
-- Name: idx_knowledge_bases_tenant_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_knowledge_bases_tenant_id ON public.knowledge_bases USING btree (tenant_id);


--
-- Name: idx_knowledge_bases_tenant_vector_store; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_knowledge_bases_tenant_vector_store ON public.knowledge_bases USING btree (tenant_id, vector_store_id);


--
-- Name: idx_knowledge_tags_kb; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_knowledge_tags_kb ON public.knowledge_tags USING btree (tenant_id, knowledge_base_id);


--
-- Name: idx_knowledge_tags_kb_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_knowledge_tags_kb_name ON public.knowledge_tags USING btree (tenant_id, knowledge_base_id, name);


--
-- Name: idx_knowledge_tags_seq_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_knowledge_tags_seq_id ON public.knowledge_tags USING btree (seq_id);


--
-- Name: idx_knowledges_base_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_knowledges_base_id ON public.knowledges USING btree (knowledge_base_id);


--
-- Name: idx_knowledges_enable_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_knowledges_enable_status ON public.knowledges USING btree (enable_status);


--
-- Name: idx_knowledges_folder_path; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_knowledges_folder_path ON public.knowledges USING btree (tenant_id, knowledge_base_id, folder_path);


--
-- Name: idx_knowledges_kb_metadata_external_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_knowledges_kb_metadata_external_id ON public.knowledges USING btree (knowledge_base_id, ((metadata ->> 'external_id'::text)) text_pattern_ops) WHERE (deleted_at IS NULL);


--
-- Name: idx_knowledges_parse_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_knowledges_parse_status ON public.knowledges USING btree (parse_status);


--
-- Name: idx_knowledges_summary_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_knowledges_summary_status ON public.knowledges USING btree (summary_status);


--
-- Name: idx_knowledges_tenant_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_knowledges_tenant_id ON public.knowledges USING btree (tenant_id);


--
-- Name: idx_ktr_knowledge; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ktr_knowledge ON public.knowledge_tag_relations USING btree (knowledge_id);


--
-- Name: idx_ktr_tag; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ktr_tag ON public.knowledge_tag_relations USING btree (tag_id);


--
-- Name: idx_organizations_deleted_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_organizations_deleted_at ON public.organizations USING btree (deleted_at);


--
-- Name: idx_organizations_invite_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_organizations_invite_code ON public.organizations USING btree (invite_code) WHERE ((invite_code IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: idx_organizations_owner_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_organizations_owner_id ON public.organizations USING btree (owner_id);


--
-- Name: idx_organizations_owner_tenant; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_organizations_owner_tenant ON public.organizations USING btree (owner_tenant_id);


--
-- Name: idx_tenants_agent_config; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tenants_agent_config ON public.tenants USING gin (agent_config);


--
-- Name: idx_tenants_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_tenants_status ON public.tenants USING btree (status);


--
-- Name: idx_users_deleted_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_deleted_at ON public.users USING btree (deleted_at);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_is_system_admin; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_is_system_admin ON public.users USING btree (is_system_admin);


--
-- Name: idx_users_tenant_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_tenant_id ON public.users USING btree (tenant_id);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- Name: users fk_users_tenant; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict vJlQnwmfd4OffjFWFj1eGfI2dMRM7OtP2QK0DxwhdmVbsRFv4Me6XlPc9MMJbkM

