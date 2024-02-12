import { injectable } from 'tsyringe';
import fs from 'fs/promises';
import TelegramBot from 'node-telegram-bot-api';
import { ConfigService } from '@config';
import { Channel, MessengerClient } from '../domain/MessengerClient';
import { MessengerMessageEmitter } from '../domain/MessengerMessageEmitter';
import { Message } from '../domain/Message';

@injectable()
export class TelegramClient implements MessengerClient {
  public readonly memoryPath = './memory/';
  private readonly config = new ConfigService().getConfig();
  private confinamentChannels: string[];
  public client: TelegramBot;
  public channels: Record<string, Channel>;

  constructor() {}

  /**
   * Load memory file
   */
  private async load(): Promise<void> {
    this.channels = JSON.parse(
      await fs
        .readFile(
          `${this.memoryPath}${
            (await this.client.getMe()).username
          }_telegram.json`,
          'utf-8',
        )
        .catch(() => `{}`),
    );
  }

  /**
   * Stores the memory file
   */
  private async save(): Promise<void> {
    Object.keys(this.channels).forEach((channelId) => {
      this.channels[channelId].messages = this.channels[
        channelId
      ].messages?.slice(0, 100);
    });
    await fs.mkdir(this.memoryPath, { recursive: true });

    await fs.writeFile(
      `${this.memoryPath}${(await this.client.getMe()).username}_telegram.json`,
      JSON.stringify(this.channels),
    );
  }

  private async parseMessage(message: TelegramBot.Message): Promise<Message> {
    const isDM = !message.group_chat_created;
    const isReplied =
      message.reply_to_message?.from?.id == (await this.client.getMe()).id ||
      false;
    // Check if it has been mentioned
    const me = await this.client.getMe();
    const isMentioned = !!message.entities?.find((entity) => {
      return entity.type == 'mention' && entity.user?.id == me.id;
    });
    // Get reply message
    let replyMessage = '';
    let replyAuthor = '';
    if (isReplied) {
      replyMessage = message.reply_to_message.text;
      replyAuthor = message.reply_to_message.from.username;
    }

    return {
      channelId: message.chat.id.toString(),
      username: message.from.username,
      content: message.text,
      date: new Date(message.date),
      isDM,
      isReplied,
      replyAuthor,
      replyMesage: replyMessage,
      isMentioned,
    };
  }
  public async sendMessage(message: string, channelId: string): Promise<void> {
    await this.client.sendMessage(channelId, message);
  }
  public async connect(): Promise<MessengerClient> {
    this.client = new TelegramBot(this.config.telegram.token, {
      polling: true,
    });
    await this.load();
    return this;
  }
  public async setStatus(): Promise<MessengerClient> {
    // There is not status on telegram
    return this;
  }
  public async deleteMessages() {
    // Telegram does not allow this
  }
  public async listenMessages(): Promise<MessengerMessageEmitter> {
    const emitter = new MessengerMessageEmitter();

    this.client.addListener('message', async (message) => {
      // Check if the message comes from a confinament channel
      const isDM = !message.group_chat_created;
      if (
        !isDM && // Is not DM
        this.confinamentChannels.length &&
        !this.confinamentChannels.includes(message.chat.id.toString())
      )
        return;

      const parsedMessage = await this.parseMessage(message);
      this.channels[message.chat.id.toString()] = {
        isDM,
        channelId: message.chat.id.toString(),
        usernames: await this.getUsernames(message.chat.id.toString()),
        messages: this.channels[message.chat.id.toString()]?.messages?.concat(
          parsedMessage,
        ) || [parsedMessage],
      };
      await this.save();
      emitter.emit('message', parsedMessage);
    });
    return emitter;
  }
  public async getUsernames(channelId: string): Promise<string[]> {
    const channel = await this.client.getChat(channelId);
    return [
      ...new Set(
        (this.channels[channelId]?.usernames || []).concat(
          channel.active_usernames,
        ),
      ),
    ].filter((u) => !!u);
  }
  public async getHistory(
    channelId: string,
    maxHistory: number,
  ): Promise<Message[]> {
    return this.channels[channelId].messages?.slice(0, maxHistory) || [];
  }
  public async setIsTypping(channelId: string): Promise<void> {
    this.client.sendChatAction(channelId, 'typing');
  }
  public async isTypping(): Promise<boolean> {
    // Telegram does not support this
    // Asume is always typping
    return false;
  }
}
