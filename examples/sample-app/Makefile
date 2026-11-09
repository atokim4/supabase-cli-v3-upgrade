.PHONY: repair diff

repair:
	supabase migration repair --linked 20240101000000 --status reverted

diff:
	supabase db diff --use-pg-schema -f schema_change
