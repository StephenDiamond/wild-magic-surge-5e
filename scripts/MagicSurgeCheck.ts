import { WMSCONST } from "./WMSCONST";
import Chat from "./Chat";
import TidesOfChaos from "./TidesOfChaos";
import RollTableMagicSurge from "./RollTableMagicSurge";
import IncrementalCheck from "./utils/IncrementalCheck";
import SpellLevelTrigger from "./utils/SpellLevelTrigger";
import DieDescending from "./utils/DieDescending";
import AutoEffects from "./AutoEffects";
import CallHooks from "./utils/CallHooks";
import SurgeDetails from "./utils/SurgeDetails";
import Logger from "./Logger";
import TriggerMacro from "./TriggerMacro";

/**
 * Main entry point for Wild Magic Surge Checks
 * @class MagicSurgeCheck
 * @param actor - Foundry Actor
 * @example
 * let magicSurgeCheck = new MagicSurgeCheck(actor);
 */
class MagicSurgeCheck {
  _actor: Actor;
  _tokenId: string | undefined;
  constructor(actor: Actor, tokenId: string | undefined) {
    this._actor = actor;
    this._tokenId = tokenId;
  }

  async _rollPlayerTrigger(
    rollTableName: string,
    chatType: string,
    roll: Roll | undefined = undefined,
  ) {
    let chatSurgeMessage = "";
    if (
      game.settings.get(
        `${WMSCONST.MODULE_ID}`,
        `${WMSCONST.OPT_ROLLTABLE_ENABLE}`,
      ) === "PLAYER_TRIGGER"
    ) {
      chatSurgeMessage = `<br /><div class="card-buttons wms-roll-table-buttons">
          <button class="roll-table-wms">
          ${game.i18n.format(
            "WildMagicSurge5E.es_roll_on_table",
          )} ${rollTableName}
          </button>
      </div>`;
    }
    Chat.Send(
      chatType,
      `${game.settings.get(
        `${WMSCONST.MODULE_ID}`,
        `${WMSCONST.OPT_AUTO_D20_MSG}`,
      )}${chatSurgeMessage}`,
      roll,
    );
  }

  /**
   * Entry point for Chat Message Hook. Check the message is valid and if so do Surge checks.
   * @param item - Item5e object
   * @returns Promise<void>
   */
  async CheckItem(item: Item): Promise<void> {
    const itemSurgeDetails = new SurgeDetails(this._actor, item);

    if (!itemSurgeDetails.valid) return;

    if (itemSurgeDetails.hasPathOfWildMagicFeat) {
      if (
        game.settings.get(
          `${WMSCONST.MODULE_ID}`,
          `${WMSCONST.OPT_ROLLTABLE_ENABLE}`,
        ) === "PLAYER_TRIGGER"
      ) {
        this._rollPlayerTrigger(
          game.settings.get(
            `${WMSCONST.MODULE_ID}`,
            `${WMSCONST.OPT_POWM_ROLLTABLE_NAME}`,
          ),
          WMSCONST.CHAT_TYPE.DEFAULT,
        );
      } else {
        RollTableMagicSurge.Check(
          WMSCONST.SURGE_FEAT_TYPE.PathOfWildMagic,
          this._actor,
        );
      }
    } else {
      if (
        game.settings.get(`${WMSCONST.MODULE_ID}`, `${WMSCONST.OPT_AUTO_D20}`)
      ) {
        await this.AutoSurgeCheck(
          itemSurgeDetails.spellLevel,
          game.settings.get(
            `${WMSCONST.MODULE_ID}`,
            `${WMSCONST.OPT_SURGE_TYPE}`,
          ),
        );
      } else {
        Chat.RunMessageCheck();
      }
    }
  }

  /**
   * @private
   * @returns RollResult
   */
  async WildMagicSurgeRollCheck(
    spellLevel?: string,
  ): Promise<Roll | undefined> {
    let diceFormula: DieValue = undefined;

    switch (
      game.settings.get(`${WMSCONST.MODULE_ID}`, `${WMSCONST.OPT_SURGE_TYPE}`)
    ) {
      case WMSCONST.ROLL_CHECK_TYPE.DIE_DESCENDING:
        diceFormula = await DieDescending.DieFormula(this._actor);
        break;
      case WMSCONST.ROLL_CHECK_TYPE.SPELL_LEVEL_DEPENDENT_ROLL:
        diceFormula = SpellLevelTrigger.ParseRollFormula(spellLevel);
        break;
      default:
        diceFormula = game.settings.get(
          `${WMSCONST.MODULE_ID}`,
          `${WMSCONST.OPT_CUSTOM_ROLL_DICE_FORMULA}`,
        );
        break;
    }

    if (!diceFormula) {
      Logger.error(
        `Cannot find dice formula`,
        "magicsurgecheck.WildMagicSurgeRollCheck",
      );
      return;
    }

    const data = this._actor ? this._actor.getRollData() : {};
    const roll = new Roll(diceFormula, data);
    await roll.evaluate({ allowInteractive: false });
    await roll.toMessage();

    return roll;
  }

  /**
   * If there are more than 1 Surge numbers to check against, split them into an array.
   * @private
   * @param {string} resultValues
   * @returns Array<string>
   */
  SplitRollResult(resultValues: string): Array<string> {
    return resultValues.toString().replace(/\s/g, "").split(",");
  }

  /**
   * On a Default Wild Magic Surge, check the result of the roll against the specified roll target.
   * @private
   * @param {string} result
   * @param {Comparison} comparison
   * @returns boolean
   */
  DefaultMagicSurgeRollResult(result: number, comparison: Comparison): boolean {
    const rollResult = result;
    const rollResultTargets = this.SplitRollResult(
      game.settings.get(
        `${WMSCONST.MODULE_ID}`,
        `${WMSCONST.OPT_CUSTOM_ROLL_RESULT}`,
      ),
    );

    for (const resultTarget of rollResultTargets) {
      const rollResultTarget = parseInt(resultTarget);

      switch (comparison) {
        case WMSCONST.COMPARISON.EQ:
          if (rollResult === rollResultTarget) {
            return true;
          }
          break;
        case WMSCONST.COMPARISON.GT:
          if (rollResult > rollResultTarget) {
            return true;
          }
          break;
        case WMSCONST.COMPARISON.LT:
          if (rollResult < rollResultTarget) {
            return true;
          }
          break;
      }
    }

    return false;
  }

  /**
   * Automatically checks for a surge against the spell level and game type.
   * @param {string} spellLevel
   * @param {string} gameType
   * @returns Promise<void>
   */
  async AutoSurgeCheck(spellLevel: string, gameType: string): Promise<void> {
    let isSurge = false;
    let roll: Roll | undefined;

    let isAutoSurge = false;
    if (
      game.settings.get(
        `${WMSCONST.MODULE_ID}`,
        `${WMSCONST.OPT_SURGE_TOC_ENABLED}`,
      )
    ) {
      if (await TidesOfChaos.IsTidesOfChaosUsed(this._actor)) {
        isAutoSurge = true;
        this.SurgeTidesOfChaos();
      }
    }

    if (!isAutoSurge) {
      roll = await this.WildMagicSurgeRollCheck(spellLevel);
      if (!roll) return;
      const rollTotal = roll.total ?? 1;
      switch (gameType) {
        case "DEFAULT":
          isSurge = this.DefaultMagicSurgeRollResult(
            rollTotal,
            game.settings.get(
              `${WMSCONST.MODULE_ID}`,
              `${WMSCONST.OPT_CUSTOM_ROLL_RESULT_CHECK}`,
            ),
          );
          break;
        case "INCREMENTAL_CHECK":
        case "INCREMENTAL_CHECK_CHAOTIC": {
          const maxValue = gameType === `INCREMENTAL_CHECK_CHAOTIC` ? 10 : 20;
          isSurge = await IncrementalCheck.Check(
            this._actor,
            rollTotal,
            maxValue,
          );
          break;
        }
        case "SPELL_LEVEL_DEPENDENT_ROLL": {
          isSurge = SpellLevelTrigger.Check(rollTotal, spellLevel);
          break;
        }
        case "DIE_DESCENDING": {
          isSurge = await DieDescending.Check(this._actor, rollTotal);
          break;
        }
        default:
          Logger.error(
            `Cannot find gameType ${gameType}`,
            "magicsurgecheck.AutoSurgeCheck",
            gameType,
          );
          return;
      }
      this.SurgeWildMagic(isSurge, roll);
    }
  }

  /**
   * Fires a hook for external integrations when a surge happens.
   * @private
   * @param {boolean} isSurge
   * @param {RollResult} rollResult
   */
  async _callIsSurgeHook(isSurge: boolean, rollResult?: Roll): Promise<void> {
    CallHooks.Call("IsWildMagicSurge", {
      surge: isSurge,
      result: rollResult?.result,
      tokenId: this._tokenId,
      actorId: this._actor.id,
    });

    if (isSurge && this._actor.id) {
      TriggerMacro.Run(this._actor.id, this._actor.id);
    }
  }

  /**
   * Calls a standard Wild Magic Surge.
   * @private
   * @param isSurge -
   * @param roll -
   */
  async SurgeWildMagic(isSurge: boolean, roll: Roll): Promise<void> {
    if (isSurge) {
      await this._actor.setFlag(
        WMSCONST.MODULE_FLAG_NAME,
        WMSCONST.HAS_SURGED_FLAG_OPTION,
        true,
      );
      if (
        game.settings.get(
          `${WMSCONST.MODULE_ID}`,
          `${WMSCONST.OPT_AUTO_D20_MSG_ENABLED}`,
        )
      ) {
        this._rollPlayerTrigger(
          game.settings.get(
            `${WMSCONST.MODULE_ID}`,
            `${WMSCONST.OPT_ROLLTABLE_NAME}`,
          ),
          WMSCONST.CHAT_TYPE.ROLL,
          roll,
        );
      }
      TidesOfChaos.Check(this._actor);
      const tableResult = await RollTableMagicSurge.Check(
        undefined,
        this._actor,
      );
      let flavorText = `${game.i18n.format(
        "WildMagicSurge5E.es_wild_magic_surge_with_roll",
      )} ${roll?.result}`;
      if (tableResult) {
        flavorText = tableResult;
      }
      this._callIsSurgeHook(true, roll);
      this._callEncounterStatistic({
        EventName: game.i18n.format("WildMagicSurge5E.es_wild_magic_surge"),
        actorId: this._actor.id,
        FlavorText: flavorText,
      });
      AutoEffects.Run(this._tokenId);
    } else {
      await this._actor.setFlag(
        WMSCONST.MODULE_FLAG_NAME,
        WMSCONST.HAS_SURGED_FLAG_OPTION,
        false,
      );
      if (
        game.settings.get(
          `${WMSCONST.MODULE_ID}`,
          `${WMSCONST.OPT_AUTO_D20_MSG_NO_SURGE_ENABLED}`,
        )
      ) {
        Chat.Send(
          WMSCONST.CHAT_TYPE.ROLL,
          game.settings.get(
            `${WMSCONST.MODULE_ID}`,
            `${WMSCONST.OPT_AUTO_D20_MSG_NO_SURGE}`,
          ),
          roll,
        );
      }
      this._callIsSurgeHook(false, roll);
    }
  }

  /**
   * Calls the Surge for the Tides of Chaos auto surge.
   * @private
   */
  async SurgeTidesOfChaos(): Promise<void> {
    await this._actor.setFlag(
      WMSCONST.MODULE_FLAG_NAME,
      WMSCONST.HAS_SURGED_FLAG_OPTION,
      true,
    );
    const tableResult = await RollTableMagicSurge.Check(
      WMSCONST.SURGE_FEAT_TYPE.TidesOfChaosSurge,
      this._actor,
    );
    let flavorText = `${game.i18n.format(
      "WildMagicSurge5E.es_tides_of_chaos",
    )}`;
    if (tableResult) {
      flavorText = tableResult;
    }
    if (
      game.settings.get(
        `${WMSCONST.MODULE_ID}`,
        `${WMSCONST.OPT_AUTO_D20_MSG_ENABLED}`,
      )
    ) {
      this._rollPlayerTrigger(
        game.settings.get(
          `${WMSCONST.MODULE_ID}`,
          `${WMSCONST.OPT_ROLLTABLE_NAME}`,
        ),
        WMSCONST.CHAT_TYPE.DEFAULT,
      );
    }
    TidesOfChaos.Check(this._actor);
    IncrementalCheck.Reset(this._actor);
    DieDescending.Reset(this._actor);
    this._callIsSurgeHook(true);
    AutoEffects.Run(this._tokenId);
    this._callEncounterStatistic({
      EventName: game.i18n.format("WildMagicSurge5E.es_wild_magic_surge"),
      actorId: this._actor.id,
      FlavorText: flavorText,
    });
  }

  async _callEncounterStatistic(
    encounterStatisticsEvent: EncounterStatisticsEvent,
  ) {
    if (
      game.settings.get(
        `${WMSCONST.MODULE_ID}`,
        `${WMSCONST.OPT_ENCOUNTER_STATS_ENABLED}`,
      )
    ) {
      if (game.modules.get("encounter-stats")?.active) {
        Hooks.callAll(`encounter-stats.customEvent`, {
          EventName: encounterStatisticsEvent.EventName,
          actorId: encounterStatisticsEvent.actorId,
          FlavorText: encounterStatisticsEvent.FlavorText,
        });
      } else {
        ui.notifications?.info(
          `Wild Magic Surge 5e: Encounter Statistics module is not installed or enabled in settings. Disable sending events in settings or install/enable the Encounter Statistics module.`,
        );
      }
    }
  }
}

export default MagicSurgeCheck;
