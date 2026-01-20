import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Req,
  UseGuards,
  Delete,
} from "@nestjs/common";
import { SupabaseJwtGuard } from "../auth/supabase-jwt.guard";
import { BotsService } from "./bots.service";

@Controller("bots")
@UseGuards(SupabaseJwtGuard)
export class BotsController {
  constructor(private botsService: BotsService) {}

  @Get()
  async list(@Req() req: any) {
    return this.botsService.listBots(req.user.id);
  }

  @Get(":id")
  async getOne(@Req() req: any, @Param("id") id: string) {
    return this.botsService.getBot(req.user.id, id);
  }

  @Post()
  async create(@Req() req: any, @Body() body: any) {
    return this.botsService.createBot(req.user.id, body);
  }

  @Patch(":id")
  async update(@Req() req: any, @Param("id") id: string, @Body() body: any) {
    return this.botsService.updateBot(req.user.id, id, body);
  }

  @Get(":id/settings")
  async getSettings(@Req() req: any, @Param("id") id: string) {
    return this.botsService.getBotSettings(req.user.id, id);
  }

  @Patch(":id/settings")
  async updateSettings(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.botsService.updateBotSettings(req.user.id, id, body);
  }

  @Post(":id/reset")
  async reset(@Req() req: any, @Param("id") id: string) {
    return this.botsService.resetBotData(req.user.id, id);
  }

  @Delete(":id")
  async delete(@Req() req: any, @Param("id") id: string) {
    return this.botsService.deleteBot(req.user.id, id);
  }
}
