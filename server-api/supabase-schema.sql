-- JBMSOFT Security Database Schema (Supabase / PostgreSQL)

-- 1. PC 관리 테이블
CREATE TABLE IF NOT EXISTS pcs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hostname TEXT NOT NULL,
    mac_address TEXT UNIQUE NOT NULL,
    ip_address TEXT,
    username TEXT,
    dept TEXT,
    status TEXT DEFAULT 'online', -- 'online', 'offline'
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. 보안 로그 테이블
CREATE TABLE IF NOT EXISTS security_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pc_id UUID REFERENCES pcs(id),
    log_type TEXT NOT NULL, -- 'blocked', 'allowed', 'warning'
    message TEXT NOT NULL,
    pc_name TEXT,
    ip_address TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. 승인 요청 테이블
CREATE TABLE IF NOT EXISTS approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pc_id UUID REFERENCES pcs(id),
    filename TEXT NOT NULL,
    recipient TEXT,
    requester TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    resolved_at TIMESTAMP WITH TIME ZONE,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. 글로벌 보안 정책 테이블
CREATE TABLE IF NOT EXISTS security_settings (
    id SERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 기본 보안 정책 초기 데이터 삽입
INSERT INTO security_settings (key, value) VALUES 
('global_policy', '{
    "fileGuard": true,
    "clipboardGuard": true,
    "mailGuard": true,
    "usbGuard": false,
    "blockedExtensions": ["exe", "bat", "cmd", "ps1", "sh"]
}') ON CONFLICT (key) DO NOTHING;

-- 6. 문서 열기 미리보기 (보안 로그와 분리)
CREATE TABLE IF NOT EXISTS document_opens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pc_id UUID REFERENCES pcs(id),
    hostname TEXT,
    mac_address TEXT,
    document_name TEXT NOT NULL,
    application TEXT,
    process_name TEXT,
    window_title TEXT,
    file_path TEXT,
    storage_path TEXT,
    mime_type TEXT,
    file_size INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_document_opens_created ON document_opens(created_at DESC);

-- Supabase Storage: document-previews 버킷 생성 (Dashboard → Storage → New bucket, private)
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. 원격 자동 업데이트 — PC별 현재 버전 · 진행 상태 추적 (2026-08 추가)
-- ⚠️ 실제 운영 DB의 pcs/settings/logs 테이블은 위 CREATE TABLE 구문과 컬럼이 다를 수 있습니다
--    (이 파일은 참고용이며 실제 스키마와 드리프트가 있음). 아래 ALTER는 Supabase SQL Editor에서
--    1회만 실행하면 됩니다 — 실행 전에도 서버·클라이언트는 정상 동작하며, 실행 후부터
--    관리자 패널에 PC별 설치 버전/업데이트 진행 상태가 표시됩니다.
ALTER TABLE pcs ADD COLUMN IF NOT EXISTS app_version TEXT;
ALTER TABLE pcs ADD COLUMN IF NOT EXISTS update_status TEXT;
