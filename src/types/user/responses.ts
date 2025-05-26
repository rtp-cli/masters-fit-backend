import { Profile } from "@/models/profile.schema";

export interface UserResponse {
  id: number;
  email: string;
  name: string;
  profile?: Profile;
}
