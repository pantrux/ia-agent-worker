-- Seed CRM data (matches ia-agent-mvp mock)
INSERT OR IGNORE INTO customers (id, name, industry) VALUES
  ('cust-001', 'Acme Retail', 'retail'),
  ('cust-002', 'Finance Co', 'finance'),
  ('cust-003', 'Clinic Plus', 'health');

INSERT OR IGNORE INTO orders (id, customer_id, status, total) VALUES
  ('ord-100', 'cust-001', 'pending', 49.99),
  ('ord-200', 'cust-002', 'shipped', 1200.00);
