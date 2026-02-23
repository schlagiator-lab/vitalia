-- Allow anon to update feedback fields on plans_generes.
-- The app has no Supabase Auth, plan ownership is tracked client-side via profil_id.
-- Only note_satisfaction and feedback_donne_le are updated by the frontend.

CREATE POLICY "anon_update_plans_generes_feedback"
  ON plans_generes
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
