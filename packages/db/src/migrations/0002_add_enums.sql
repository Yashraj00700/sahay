-- Create enum types
CREATE TYPE conversation_status AS ENUM ('open', 'pending', 'snoozed', 'resolved', 'closed');
CREATE TYPE conversation_channel AS ENUM ('whatsapp', 'instagram', 'webchat', 'email');
CREATE TYPE routing_decision AS ENUM ('auto_respond', 'draft_for_review', 'route_to_human', 'route_to_senior');
CREATE TYPE message_sender AS ENUM ('customer', 'agent', 'ai', 'system');
CREATE TYPE message_status AS ENUM ('sending', 'sent', 'delivered', 'read', 'failed');

-- Alter columns (existing data migration)
ALTER TABLE conversations
  ALTER COLUMN status TYPE conversation_status USING status::conversation_status,
  ALTER COLUMN channel TYPE conversation_channel USING channel::conversation_channel,
  ALTER COLUMN routing_decision TYPE routing_decision USING routing_decision::routing_decision;

ALTER TABLE messages
  ALTER COLUMN sender_type TYPE message_sender USING sender_type::message_sender,
  ALTER COLUMN channel_status TYPE message_status USING channel_status::message_status;
