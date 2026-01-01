import { Module } from "@nestjs/common";
import { BotsModule } from "./bots/bots.module";
import { SourcesModule } from "./sources/sources.module";
import { ChatModule } from "./chat/chat.module";
import { WidgetModule } from "./widget/widget.module";
import { ConversationsModule } from "./conversations/conversations.module";

@Module({
  imports: [
    BotsModule,
    SourcesModule,
    ChatModule,
    WidgetModule,
    ConversationsModule,
  ],
})
export class AppModule {}
