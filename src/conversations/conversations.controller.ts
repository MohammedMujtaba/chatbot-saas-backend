import { Controller, Get, Param, Query, Req, UseGuards } from "@nestjs/common";
import { SupabaseJwtGuard } from "../auth/supabase-jwt.guard";
import { ConversationsService } from "./conversations.service";

@Controller("bots")
@UseGuards(SupabaseJwtGuard)
export class ConversationsController {
  constructor(private svc: ConversationsService) {}

  @Get(":id/stats")
  stats(
    @Req() req: any,
    @Param("id") botId: string,
    @Query("days") days?: string,
  ) {
    return this.svc.stats(req.user.id, botId, Number(days ?? 7));
  }

  @Get(":id/conversations")
  list(
    @Req() req: any,
    @Param("id") botId: string,
    @Query("query") query?: string,
  ) {
    return this.svc.list(req.user.id, botId, query ?? "");
  }
}
