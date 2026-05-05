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

-- 5. 관리자 계정 테이블
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
