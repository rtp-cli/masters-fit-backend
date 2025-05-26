import { Profile } from "@/models";
import { ApiResponse } from "../common/responses";

export interface ProfileResponse extends ApiResponse {
  profile?: Profile;
}
