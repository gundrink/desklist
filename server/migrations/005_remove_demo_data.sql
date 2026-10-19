-- v6: production uses real data only. Remove every demo team (cascades to members, sessions, projects,
-- tasks, reimbursements, team templates) and any leftover demo-flagged rows. System data kept:
-- field_definitions and built-in (team_id IS NULL) templates.
DELETE FROM desklist.teams WHERE is_demo OR id = '00000000-0000-4000-8000-0000000000d0';
DELETE FROM desklist.projects WHERE is_demo;
DELETE FROM desklist.members WHERE is_demo;
