CREATE TABLE IF NOT EXISTS pricing_client_profile (
  id CHAR(36) NOT NULL PRIMARY KEY,
  project_id VARCHAR(64) NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  ppe VARCHAR(64) NULL,
  station VARCHAR(64) NULL,
  context_json LONGTEXT NULL,
  revision INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY client_tariff_project (project_id),
  UNIQUE KEY client_tariff_station (station)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pricing_client_period (
  id CHAR(36) NOT NULL PRIMARY KEY,
  profile_id CHAR(36) NOT NULL,
  valid_from DATE NULL,
  valid_until DATE NULL,
  osd_id INT NOT NULL,
  tariff_id INT NOT NULL,
  source VARCHAR(16) NOT NULL,
  overrides_json LONGTEXT NOT NULL,
  schedule_json LONGTEXT NULL,
  note VARCHAR(1000) NOT NULL DEFAULT '',
  KEY client_tariff_period (profile_id, valid_from),
  CONSTRAINT client_tariff_period_profile FOREIGN KEY (profile_id) REFERENCES pricing_client_profile(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pricing_client_change (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  profile_id CHAR(36) NOT NULL,
  revision INT NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  action VARCHAR(32) NOT NULL,
  before_json LONGTEXT NOT NULL,
  after_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY client_tariff_change (profile_id, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pricing_client_evidence (
  id CHAR(64) NOT NULL PRIMARY KEY,
  profile_id CHAR(36) NOT NULL,
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  tariff_code VARCHAR(100) NULL,
  state VARCHAR(16) NOT NULL,
  evidence_json LONGTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY client_tariff_evidence (profile_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Full tariff/schedule snapshots supplement the existing monetary audit versions.
CREATE TABLE IF NOT EXISTS pricing_catalog_revision (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tariff_id INT NOT NULL,
  osd_id INT NOT NULL,
  valid_from DATE NOT NULL,
  valid_until DATE NULL,
  payload_json LONGTEXT NOT NULL,
  fingerprint CHAR(64) NOT NULL,
  source VARCHAR(100) NOT NULL,
  superseded TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY tariff_revision_from (tariff_id, valid_from, superseded)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
