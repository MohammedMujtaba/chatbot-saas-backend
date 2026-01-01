import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { WidgetService } from "./widget.service";

@Controller("widget")
export class WidgetController {
  constructor(private widgetService: WidgetService) {}

  @Post("chat")
  async chat(@Body() body: any) {
    return this.widgetService.chat(body);
  }

  @Get("config/:embedKey")
  getConfig(@Param("embedKey") embedKey: string) {
    return this.widgetService.getConfig(embedKey);
  }
}
