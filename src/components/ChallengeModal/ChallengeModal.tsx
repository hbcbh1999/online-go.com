/*
 * Copyright (C) 2012-2017  Online-Go.com
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import data from "data";
import player_cache from "player_cache";
import * as React from "react";
import {browserHistory} from "react-router";
import {_, pgettext, interpolate} from "translate";
import {post, del} from "requests";
import {Modal, openModal} from "Modal";
import {termination_socket} from "sockets";
import {errorLogger, errorAlerter, longRankString, rulesText, dup, rankString, ignore} from "misc";
import {PlayerIcon} from "components";
import {timeControlText, shortShortTimeControl, isLiveGame, TimeControlPicker} from "TimeControl";
import preferences from "preferences";
import {notification_manager} from "Notifications";
import {one_bot, bot_count, bots_list} from "bots";
import {openForkModal} from "./ForkModal";

declare let swal;


type ChallengeModes = "open" | "computer" | "player" | "demo";

interface ChallengeModalProperties {
    mode: ChallengeModes;
    playerId?: number;
    initialState?: any;
    config?: any;
    autoCreate?: boolean;
}


function deepAssign(obj1: any, obj2: any) {{{
    if (typeof(obj1) !== "object" || typeof(obj2) !== "object") {
        return obj1;
    }
    if (Array.isArray(obj2)) {
        return obj2;
    }
    for (let k in obj2) {
        if (typeof(obj2[k]) === "object" && !Array.isArray(obj2[k])) {
            if (typeof(obj1[k]) === "object" && !Array.isArray(obj1[k])) {
                obj1[k] = deepAssign(obj1[k], obj2[k]);
            } else {
                obj1[k] = deepAssign({}, obj2[k]);
            }
        } else {
            obj1[k] = obj1[k];
        }
    }

    return obj1;
}}}


export let username_to_id = {};

/* Constants {{{ */


let negKomiRanges = [];
let posKomiRanges = [];
let maxKomi = 36.5;
for (let komi = 0.0; komi <= maxKomi; komi += 0.5) {
    if (komi - maxKomi !== 0.0) { negKomiRanges.push(komi - maxKomi); }
    posKomiRanges.push(komi);
}

let handicapRanges = [];
for (let i = 1; i <= 36; ++i) {
    handicapRanges.push(i);
}
export let ranks = [];
export let ranked_ranks = [];
export let demo_ranks = [];
for (let i = 0; i < 37; ++i) {
    let title = longRankString(i);
    demo_ranks.push({
        "rank": i,
        "label": title
    });

    //if (i === 0) title = _('Beginner');
    if (i === 36) {
        title += "+";
    }

    ranks.push({
        "rank": i,
        "label": title
    });
    if (data.get("user") && (i >= data.get("user").ranking - 9) && (i <= data.get("user").ranking + 9)) {
        ranked_ranks.push({
            "rank": i,
            "label": title
        });
    }
}
for (let i = 37; i <= 45; ++i) {
    let title = longRankString(i + 1000);
    demo_ranks.push({
        "rank": i + 1000,
        "label": title
    });
}

/* }}} */

export class ChallengeModal extends Modal<ChallengeModalProperties, any> {
    refs: {
        time_control_picker
    };
    constructor(props) { /* {{{ */
        super(props);

        let speed = data.get("challenge.speed", "live");

        let challenge = data.get(`challenge.challenge.${speed}`, {
            initialized: false,
            min_ranking: 5,
            max_ranking: 36,
            challenger_color: "automatic",
            game: {
                name: "",
                rules: "japanese",
                ranked: true,
                width: 19,
                height: 19,
                handicap: 0,
                komi_auto: "automatic",
                komi: 5.5,
                disable_analysis: false,
                initial_state: null,
                "private": false,
            },
        });

        challenge.game.initial_state = null;
        if (challenge.game.komi == null) {
            challenge.game.komi = 5.5;
        }


        if (this.props.initialState) {
            challenge.game.initial_state = this.props.initialState;
        } else {
            challenge.game.width = preferences.get("new-game-board-size");
            challenge.game.height = preferences.get("new-game-board-size");
        }

        this.state = {
            conf: {
                mode: this.props.mode,
                username: "",
                bot_id: data.get("challenge.bot", 0),
                handicap_enabled: data.get("challenge.handicap_enabled", false),
                //selected_board_size: data.get('challenge.size', '19x19'),
                selected_board_size: preferences.get("new-game-board-size") + "x" + preferences.get("new-game-board-size"),
                restrict_rank: data.get("challenge.restrict_rank", false),
            },
            //time_control: recallTimeControlSettings(speed),
            challenge: challenge,
            demo: data.get("demo.settings", {
                name: "",
                rules: "japanese",
                width: 19,
                height: 19,
                black_name: _("Black"),
                black_ranking: 1039,
                white_name: _("White"),
                white_ranking: 1039,
                "private": false,
            }),
        };


        if (this.props.config) {
            if (this.props.config.challenge) {
                this.state.challenge = Object.assign(this.state.challenge, this.props.config.challenge);
            }

            if (this.props.config.conf) {
                this.state.conf = Object.assign(this.state.conf, this.props.config.conf);
            }

            if (this.props.config.time_control) {
                this.state.initial_time_control = this.props.config.time_control;
            }
        }


        if (this.state.conf.mode === "computer" && bot_count()) {
            let found_bot = false;
            for (let bot of bots_list()) {
                if (this.state.conf.bot_id === bot.id) {
                    found_bot = true;
                }
            }
            if (!found_bot)  {
                this.state.conf.bot_id = bots_list()[0].id;
            }
        }

        if (this.props.autoCreate) {
            setTimeout(() => {
                this.createChallenge();
                this.close();
            }, 1);
        }
    } /* }}} */

    syncBoardSize(value) {{{
        let conf = dup(this.state.conf);
        let challenge = dup(this.state.challenge);

        conf.selected_board_size = value;
        if (value !== "custom") {
            let sizes = conf.selected_board_size.split("x");
            challenge.game.width = parseInt(sizes[0]);
            challenge.game.height = parseInt(sizes[1]);
        }

        this.setState({ conf: conf, challenge: challenge});
    }}}
    setAGARanked(tf) {{{
        let next = this.nextState();

        next.challenge.aga_ranked = tf;
        if (tf && this.state.challenge && data.get("user")) {
            next.challenge.game.ranked = true;
            this.state.setRanked(true);
        } else {
            this.setState({challenge: next.challenge});
        }
    }}}

    setRanked(tf) { /* {{{ */
        let next = this.nextState();

        next.challenge.game.ranked = tf;
        if (tf && this.state.challenge && data.get("user")) {
            next.challenge.game.handicap = Math.min(9, this.state.challenge.game.handicap);
            next.challenge.game.komi_auto = "automatic";
            next.challenge.min_ranking = Math.max(this.state.challenge.min_ranking, data.get("user").ranking - 9);
            next.challenge.min_ranking = Math.min(this.state.challenge.min_ranking, data.get("user").ranking + 9);
            next.challenge.max_ranking = Math.max(this.state.challenge.max_ranking, data.get("user").ranking - 9);
            next.challenge.max_ranking = Math.min(this.state.challenge.max_ranking, data.get("user").ranking + 9);

            if (
                this.state.conf.selected_board_size !== "19x19" &&
                this.state.conf.selected_board_size !== "13x13" &&
                this.state.conf.selected_board_size !== "9x9"
            ) {
                next.conf.selected_board_size = "19x19";
            }
        } else {
            next.challenge.aga_ranked = false;
        }

        this.setState({
            challenge: next.challenge,
            conf: next.conf,
        });
    } /* }}} */

    setHandicapsEnabled(tf) {{{
        let next = this.next();
        next.conf.handicap_enabled = tf;
        next.challenge.game.handicap = tf ? (next.challenge.game.handicap === 0 ? -1 : next.challenge.game.handicap) : 0;
        this.setState({
            conf: next.conf,
            challenge: next.challenge,
        });
    }}}

    saveSettings() {{{
        let next = this.next();
        if (this.refs.time_control_picker) {
            this.refs.time_control_picker.saveSettings();
        }
        let speed = data.get("challenge.speed", "live");
        data.set("challenge.challenge." + speed, next.challenge);
        data.set("challenge.handicap_enabled", next.conf.handicap_enabled);
        data.set("challenge.bot", next.conf.bot_id);
        data.set("challenge.size", next.conf.selected_board_size);
        data.set("challenge.restrict_rank", next.conf.restrict_rank);
        data.set("demo.settings", next.demo);
    }}}
    createDemo = () => {{{
        if (!this.validateBoardSize()) { return; }

        let next = this.next();

        next.demo.width = next.challenge.game.width;
        next.demo.height = next.challenge.game.height;
        next.demo.name = next.challenge.game.name;

        next.demo.width = next.challenge.game.width;
        next.demo.height = next.challenge.game.height;

        this.setState({
            demo: next.demo
        });


        let demo: any = {};
        for (let k in next.demo) {
            demo[k] = next.demo[k];
        }

        console.log(demo);

        demo.black_pro = demo.black_ranking > 1000 ? 1 : 0;
        if (demo.black_pro) {
            demo.black_ranking -= 1000;
        }
        demo.white_pro = demo.white_ranking > 1000 ? 1 : 0;
        if (demo.white_pro) {
            demo.white_ranking -= 1000;
        }
        console.log("Sending", demo);

        this.close();
        post("demos", demo).then((res) => {
            console.log("Demo create response: ", res);
            browserHistory.push(`/demo/view/${res.id}`);
        }).catch(errorAlerter);
    }}}
    validateBoardSize() {{{
        let next = this.next();

        try {
            if (!parseInt(next.challenge.game.width) || next.challenge.game.width < 1 || next.challenge.game.width > 25) {
                $("#challenge-goban-width").focus();
                return false;
            }
            if (!parseInt(next.challenge.game.height) || next.challenge.game.height < 1 || next.challenge.game.height > 25) {
                $("#challenge-goban-height").focus();
                return false;
            }
        } catch (e) {
            return false;
        }
        return true;
    }}}
    createChallenge = () => {{{
        let next = this.next();

        if (!this.validateBoardSize()) {
            swal(_("Invalid board size, please correct and try again"));
            return;
        }
        /*
            swal(_("Invalid time settings, please correct them and try again"));
            return;
        }
        */
        let conf = next.conf;

        if (next.challenge.game.ranked) {
            next.challenge.game.komi_auto = "automatic";
        }
        if (next.challenge.game.komi_auto === "automatic") {
            next.challenge.game.komi = null;
        }

        let challenge: any = Object.assign({}, next.challenge);
        challenge.game = Object.assign({}, next.challenge.game);

        let player_id = 0;
        if (this.props.mode === "player") {
            player_id = this.props.playerId;
            if (!player_id || (player_id === data.get("user").id)) {
                return;
            }
        }
        if (this.props.mode === "computer") {
            player_id = conf.bot_id;

            if (!player_id) {
                player_id = bot_count() === 0 ? 0 : one_bot().id;
            }

            console.log("Bot set to ", player_id);
        }

        if (!challenge.game.name || challenge.game.name.trim() === "") {
            challenge.game.name = _("Friendly Match");
        }


        if (!conf.restrict_rank) {
            challenge.min_ranking = -1000;
            challenge.max_ranking = 1000;
        }
        if (!conf.handicap_enabled) {
            challenge.game.handicap = 0;
        }

        challenge.game.width = parseInt(challenge.game.width);
        challenge.game.height = parseInt(challenge.game.height);

        challenge.game.time_control = this.refs.time_control_picker.time_control.system;
        challenge.game.time_control_parameters = this.refs.time_control_picker.time_control;
        challenge.game.time_control_parameters.time_control =
            this.refs.time_control_picker.time_control.system; /* on our backend we still expect this to be named `time_control` for
                                                                  old legacy reasons.. hopefully we can reconcile that someday */
        challenge.game.pause_on_weekends = this.refs.time_control_picker.time_control.pause_on_weekends;


        let open_now = false;
        if (isLiveGame(challenge.game.time_control_parameters)) {
            open_now = true;
        }
        if (this.props.mode === "computer") {
            open_now = true;
        }
        /*
        if (this.props.mode === "demo") {
            open_now = true;
        }
        */

        console.log(challenge);
        if (challenge.game.initial_state && Object.keys(challenge.game.initial_state).length === 0) {
            challenge.game.initial_state = null;
        }

        this.saveSettings();
        this.close();

        post(player_id ? `players/${player_id}/challenge` : "challenges", challenge)
        .then((res) => {
                console.log("Challenge response: ", res);
                let challenge_id = res.challenge;
                let game_id = typeof(res.game) === "object" ? res.game.id : res.game;

                notification_manager.event_emitter.on("notification", checkForReject);

                if (open_now) {
                    swal({
                        title: _("Waiting for opponent"),
                        html: '<div class="spinner"><div class="double-bounce1"></div><div class="double-bounce2"></div></div>',
                        confirmButtonClass: "btn-danger",
                        confirmButtonText: "Cancel",
                        allowOutsideClick: false,
                        allowEscapeKey: false,
                    })
                    .then(() => {
                        off();
                        /* cancel challenge */
                        del(this.props.mode === "open" ? `challenges/${challenge_id}` : `me/challenges/${challenge_id}`)
                        .then(ignore)
                        .catch(ignore);
                    })
                    .catch(() => {
                        off();
                    });


                    active_check();
                } else {
                    if (this.props.mode === "open") {
                        swal(_("Challenge created!"));
                    } else if (this.props.mode === "player") {
                        swal(_("Challenge sent!"));
                    }
                }

                let keepalive_interval;

                function active_check() {
                    keepalive_interval = setInterval(() => {
                        termination_socket.send("challenge/keepalive", {challenge_id: challenge_id, game_id: game_id});
                    }, 1000);
                    termination_socket.send("game/connect", {"game_id": game_id});
                    termination_socket.on(`game/${game_id}/gamedata`, onGamedata);
                }

                function onGamedata() {
                    off();
                    swal.close();
                    browserHistory.push(`/game/${game_id}`);
                }

                function onRejected() {
                    off();
                    swal.close();
                    swal({
                        text: _("Game offer was rejected"),
                    });
                }

                function off() {
                    clearTimeout(keepalive_interval);
                    termination_socket.send("game/disconnect", {"game_id": game_id});
                    termination_socket.off(`game/${game_id}/gamedata`, onGamedata);
                    termination_socket.off(`game/${game_id}/rejected`, onRejected);
                    notification_manager.event_emitter.off("notification", checkForReject);
                }

                function checkForReject(notification) {
                    console.log(notification);
                    if (notification.type === "gameOfferRejected") {
                        /* non checked delete to purge old notifications that
                         * could be around after browser refreshes, connection
                         * drops, etc. */
                        notification_manager.deleteNotification(notification);
                        if (notification.game_id === game_id) {
                            onRejected();
                        }
                    }
                }
            })
        .catch(errorAlerter);
    }}}

    /* update bindings {{{ */
    update_conf_bot_id          = (ev) => this.upstate("conf.bot_id", ev);
    update_challenge_game_name  = (ev) => this.upstate("challenge.game.name", ev);
    update_private              = (ev) => this.upstate([["challenge.game.private", ev], ["challenge.game.ranked", false]]);
    update_demo_private         = (ev) => this.upstate("demo.private", ev);
    update_handicaps_enabled    = (ev) => this.setHandicapsEnabled((ev.target as HTMLInputElement).checked);
    update_ranked               = (ev) => this.setRanked((ev.target as HTMLInputElement).checked);
    update_aga_ranked           = (ev) => {this.setAGARanked((ev.target as HTMLInputElement).checked); };
    update_demo_rules           = (ev) => this.upstate("demo.rules", ev);
    update_board_size           = (ev) => {this.syncBoardSize((ev.target as HTMLSelectElement).value); };
    update_board_width          = (ev) => this.upstate("challenge.game.width", ev);
    update_board_height         = (ev) => this.upstate("challenge.game.height", ev);
    update_rules                = (ev) => this.upstate("challenge.game.rules", ev);
    update_handicap             = (ev) => this.upstate("challenge.game.handicap", ev);
    update_komi_auto            = (ev) => this.upstate("challenge.game.komi_auto", ev);
    update_komi                 = (ev) => this.upstate("challenge.game.komi", ev);
    update_challenge_color      = (ev) => this.upstate("challenge.challenger_color", ev);
    update_disable_analysis     = (ev) => this.upstate("challenge.game.disable_analysis", ev);
    update_restrict_rank        = (ev) => this.upstate("conf.restrict_rank", ev);
    update_min_rank             = (ev) => this.upstate("challenge.min_ranking", ev);
    update_max_rank             = (ev) => this.upstate("challenge.max_ranking", ev);
    update_demo_black_name      = (ev) => this.upstate("demo.black_name", ev);
    update_demo_white_name      = (ev) => this.upstate("demo.white_name", ev);
    update_demo_black_ranking   = (ev) => this.upstate("demo.black_ranking", ev);
    update_demo_white_ranking   = (ev) => this.upstate("demo.white_ranking", ev);
    /* }}} */


    render() {
        let mode = this.props.mode;
        let player_id = this.props.playerId;
        let player = player_id && player_cache.lookup(player_id);
        let player_username = player ? player.username : "...";
        let conf = this.state.conf;
        let challenge = this.state.challenge;

        if (player_id && !player) {
            player_cache.fetch(player_id).then(() => this.setState({player_username_resolved: true})).catch(errorLogger);
        }

        return (
          <div className="Modal ChallengeModal" ref="modal">
              <div className="header">
                  <h2>
                      {(mode === "open" || null) && <span>{_("Open Challenge")}</span> }
                      {(mode === "demo" || null) && <span>{_("Demo Board")}</span> }
                      {(mode === "player" || null) && <span className="header-with-icon"><PlayerIcon id={player_id} size={32} />&nbsp; {player_username}</span> }
                      {(mode === "computer" || null) && <span>{_("Computer")}</span> }
                  </h2>
              </div>
              <div className="body">
                <div className="challenge  form-inline">
                    <div className="challenge-pane-container">
                      <div id="challenge-basic-settings" className="left-pane pane form-horizontal" role="form">{/* {{{ */}
                          {(mode === "computer" || null) &&
                              <div className="form-group">
                                  <label className="control-label" htmlFor="engine">{_("Engine")}</label>
                                  <div className="controls">
                                    <select id="challenge-ai" value={this.state.conf.bot_id} onChange={this.update_conf_bot_id} required={true}>
                                        {bots_list().map((bot, idx) => (<option key={idx} value={bot.id}>{bot.username} ({rankString(bot.ranking)})</option>) )}
                                    </select>
                                  </div>
                              </div>
                          }
                          {(mode !== "computer" || null) &&
                              <div className="form-group">
                                  <label className="control-label" htmlFor="challenge_game_name">{_("Game Name")}</label>
                                  <div className="controls">
                                      <div className="checkbox">
                                          <input type="text" value={this.state.challenge.game.name} onChange={this.update_challenge_game_name} className="form-control" id="challenge-game-name" placeholder={_("Game Name")}/>
                                      </div>
                                  </div>
                              </div>
                          }


                          <div className="form-group">
                              <label className="control-label" htmlFor="challenge-private">
                                  {_("Private")}
                              </label>
                              <div className="controls">
                                  {(mode !== "demo" || null) && <div className="checkbox">
                                      <input type="checkbox"
                                        id="challenge-private"
                                        checked={this.state.challenge.game.private} onChange={this.update_private}/>
                                   </div>
                                  }
                                  {(mode === "demo" || null) && <div className="checkbox">
                                      <input type="checkbox"
                                        id="challenge-private"
                                        checked={this.state.demo.private} onChange={this.update_demo_private}/>
                                   </div>
                                  }

                              </div>
                          </div>
                      </div>
                      {/* }}} */}

                      {/* TODO: Initial state
                      {this.state.initial_state.map((config,idx) => (
                          <div key={idx} id='challenge-basic-settings' className='right-pane form-horizontal' role="form">
                              <ogs-goban id='challenge-goban' config='config' no-link='true'></ogs-goban>
                          </div>
                      ))}
                      */}
                      {(!this.state.initial_state || null) && /* {{{ */
                          <div id="challenge-basic-settings" className="right-pane pane form-horizontal" role="form">
                          {(mode !== "demo" || null) &&
                           <div>
                              <div className="form-group">
                                  <label className="control-label" htmlFor="challenge-handicap-enabled" id="challenge.game.handicap-enabled-label">{_("Enable Handicaps")}</label>
                                  <div className="controls">
                                      <div className="checkbox">
                                          <input type="checkbox" id="challenge-handicap-enabled" checked={this.state.conf.handicap_enabled}
                                              onChange={this.update_handicaps_enabled}/>
                                      </div>
                                  </div>
                              </div>

                              <div className="form-group">
                                  <label className="control-label" htmlFor="challenge-ranked">{_("Ranked")}</label>
                                  <div className="controls">
                                      <div className="checkbox">
                                          <input type="checkbox"
                                            id="challenge-ranked"
                                            disabled={this.state.challenge.game.private}
                                            checked={this.state.challenge.game.ranked} onChange={this.update_ranked}/>
                                      </div>
                                  </div>
                              </div>

                              {data.get("config.aga_rankings_enabled", null) &&
                                  <div className="form-group">
                                      <label className="control-label" htmlFor="challenge-aga-ranked">{_("AGA Ranked")}</label>
                                      <div className="controls">
                                          <div className="checkbox">
                                              <input type="checkbox"
                                                id="challenge-aga-ranked"
                                                disabled={this.state.challenge.game.private}
                                                checked={this.state.challenge.aga_ranked} onChange={this.update_aga_ranked}/>
                                          </div>
                                      </div>
                                  </div>
                              }
                           </div>
                          }
                          {(mode === "demo" || null) &&
                           <div>
                              <div className="form-group" id="challenge.game.rules-group">
                                  <label className="control-label" htmlFor="rules">{_("Rules")}</label>
                                  <div className="controls">
                                      <div className="checkbox">
                                          <select value={this.state.demo.rules} onChange={this.update_demo_rules} className="challenge-dropdown form-control">
                                              <option value="aga">{_("AGA")}</option>
                                              <option value="chinese">{_("Chinese")}</option>
                                              <option value="ing">{_("Ing SST")}</option>
                                              <option value="japanese">{_("Japanese")}</option>
                                              <option value="korean">{_("Korean")}</option>
                                              <option value="nz">{_("New Zealand")}</option>
                                          </select>
                                      </div>
                                  </div>
                              </div>
                           </div>
                          }
                          <div className="form-group" id="challenge-board-size-group">
                              <label className="control-label" htmlFor="challenge-board-size">{_("Board Size")}</label>
                              <div className="controls">
                                  <div className="checkbox">
                                      <select id="challenge-board-size" value={this.state.conf.selected_board_size} onChange={this.update_board_size} className="challenge-dropdown form-control">
                                          <optgroup label={_("Normal Sizes")}>
                                              <option value="19x19">19x19</option>
                                              <option value="13x13">13x13</option>
                                              <option value="9x9">9x9</option>
                                          </optgroup>
                                          <optgroup label={_("Extreme Sizes")}>
                                              <option disabled={this.state.challenge.game.ranked} value="25x25">25x25</option>
                                              <option disabled={this.state.challenge.game.ranked} value="21x21">21x21</option>
                                              <option disabled={this.state.challenge.game.ranked} value="5x5">5x5</option>
                                          </optgroup>
                                          <optgroup label={_("Non-Square")}>
                                              <option disabled={this.state.challenge.game.ranked} value="19x9">19x9</option>
                                              <option disabled={this.state.challenge.game.ranked} value="5x13">5x13</option>
                                          </optgroup>
                                          <optgroup label={_("Custom")}>
                                              <option disabled={this.state.challenge.game.ranked} value="custom">{_("Custom Size")}</option>
                                          </optgroup>
                                      </select>
                                  </div>
                              </div>
                          </div>

                          {(conf.selected_board_size === "custom" || null) &&
                              <div className="form-group">
                                  <label className="control-label" htmlFor="challenge-board-size-custom"></label>
                                  <div className="controls">
                                      <div className="checkbox">
                                        <input type="number" value={this.state.challenge.game.width} onChange={this.update_board_width} id="challenge-goban-width" className="form-control" style={{width: "3em"}} min="1" max="25"/>
                                        x
                                        <input type="number" value={this.state.challenge.game.height} onChange={this.update_board_height} id="challenge-goban-height" className="form-control" style={{width: "3em"}} min="1" max="25"/>
                                      </div>
                                  </div>
                              </div>
                          }
                        </div>
                      }{/* }}} */}
                    </div>
                    
                    <hr/>
                    {(mode !== "demo" || null) && /* {{{ */
                        <div id="challenge-advanced-fields" className="challenge-pane-container form-inline" style={{marginTop: "1em"}}>
                            <div className="left-pane pane form-horizontal">

                                {(mode !== "computer" || null) &&
                                    <div>
                                        <div className="form-group" id="challenge.game.rules-group">
                                            <label className="control-label" htmlFor="rules">{_("Rules")}</label>
                                            <div className="controls">
                                                <div className="checkbox">
                                                    <select value={this.state.challenge.game.rules} onChange={this.update_rules} id="challenge.game.rules" className="challenge-dropdown form-control">
                                                        <option value="aga">{_("AGA")}</option>
                                                        <option value="chinese">{_("Chinese")}</option>
                                                        <option value="ing">{_("Ing SST")}</option>
                                                        <option value="japanese">{_("Japanese")}</option>
                                                        <option value="korean">{_("Korean")}</option>
                                                        <option value="nz">{_("New Zealand")}</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                }
                                <TimeControlPicker value={this.state.initial_time_control} ref="time_control_picker" />
                            </div>

                            <div className="right-pane pane form-horizontal">

                                <div className="form-group" id="challenge.game.handicap-group">
                                    <label className="control-label">{_("Handicap")}</label>
                                    <div className="controls">
                                        <div className="checkbox">
                                            <select value={this.state.challenge.game.handicap} onChange={this.update_handicap} className="challenge-dropdown form-control">
                                                <option value="-1"
                                                        disabled={!this.state.conf.handicap_enabled}
                                                        >{_("Automatic")}</option>
                                                <option value="0"
                                                        >{_("None")}</option>
                                                {handicapRanges.map((n, idx) => (
                                                    <option key={idx} value={n}
                                                        disabled={!this.state.conf.handicap_enabled || n > 9 && challenge.game.ranked}
                                                        >{n}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label className="control-label">{_("Komi")}</label>
                                    <div className="controls">
                                        <div className="checkbox">
                                            <select value={this.state.challenge.game.komi_auto} onChange={this.update_komi_auto} className="challenge-dropdown form-control">
                                                <option value="automatic">{_("Automatic")}</option>
                                                <option value="custom" disabled={this.state.challenge.game.ranked}>{_("Custom")}</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                {(challenge.game.komi_auto === "custom" || null) &&
                                    <div className="form-group">
                                        <label className="control-label"></label>
                                        <div className="controls">
                                            <div className="checkbox">
                                                <input type="number" value={this.state.challenge.game.komi} onChange={this.update_komi} className="form-control" style={{width: "4em"}} step="0.5"/>
                                            </div>
                                        </div>
                                    </div>
                                }

                                <div className="form-group">
                                    <label className="control-label" htmlFor="color">{_("Your Color")}</label>
                                    <div className="controls">
                                        <div className="checkbox">
                                            <select value={this.state.challenge.challenger_color} onChange={this.update_challenge_color} id="challenge-color" className="challenge-dropdown form-control">
                                                <option value="automatic">{_("Automatic")}</option>
                                                <option value="black">{_("Black")}</option>
                                                <option value="white">{_("White")}</option>
                                                <option value="random">{_("Random")}</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                {(mode !== "computer" || null) &&
                                    <div>
                                        <div className="form-group" style={{position: "relative"}}>
                                            <label className="control-label" htmlFor="challenge-disable-analysis">{_("Disable Analysis")}</label>
                                            <div className="controls">
                                                <div className="checkbox">
                                                    <input checked={this.state.challenge.game.disable_analysis} onChange={this.update_disable_analysis} id="challenge-disable-analysis" type="checkbox"/> *
                                                </div>
                                            </div>
                                        </div>

                                        {(mode === "open" || null) &&
                                            <div>
                                                <div className="form-group" id="challenge-restrict-rank-group">
                                                    <label className="control-label" htmlFor="challenge-restrict-rank">{_("Restrict Rank")}</label>
                                                    <div className="controls">
                                                        <div className="checkbox">
                                                            <input checked={this.state.conf.restrict_rank} onChange={this.update_restrict_rank} id="challenge-restrict-rank"
                                                                type="checkbox"/>
                                                        </div>
                                                    </div>
                                                </div>
                                                {(conf.restrict_rank || null) &&
                                                    <div>

                                                        <div className="form-group" id="challenge-min-rank-group">
                                                            <label className="control-label" htmlFor="minimum_ranking">{_("Minimum Ranking")}</label>
                                                            <div className="controls">
                                                                <div className="checkbox">
                                                                    <select value={this.state.challenge.min_ranking} onChange={this.update_min_rank} id="challenge-min-rank" className="challenge-dropdown form-control">
                                                                        {(challenge.game.ranked ? ranked_ranks : ranks.slice(5, 100)).map((r, idx) => (
                                                                            <option key={idx} value={r.rank}>{r.label}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="form-group" id="challenge-max-rank-group">
                                                            <label className="control-label" htmlFor="maximum_ranking">{_("Maximum Ranking")}</label>
                                                            <div className="controls">
                                                                <div className="checkbox">
                                                                    <select value={this.state.challenge.max_ranking} onChange={this.update_max_rank} id="challenge-max-rank" className="challenge-dropdown form-control">
                                                                        {(challenge.game.ranked ? ranked_ranks : ranks.slice(5, 100)).map((r, idx) => (
                                                                            <option key={idx} value={r.rank}>{r.label}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>

                                                    </div>
                                                }
                                            </div>
                                        }
                                        <div style={{marginTop: "1.0em", textAlign: "right", fontSize: "0.8em"}}>* {_("Also disables conditional moves")}</div>
                                    </div>
                                }
                            </div>
                        </div>
                    }{/* }}} */}
                    {(mode === "demo" || null) && /* {{{ */
                        <div id="challenge-advanced-fields" className="challenge-pane-container form-inline" style={{marginTop: "1em"}}>
                            <div className="left-pane pane form-horizontal">
                                <div className="form-group">
                                    <label className="control-label" htmlFor="demo-black-name">{_("Black Player")}</label>
                                    <div className="controls">
                                        <div className="checkbox">
                                            <input type="text" className="form-control" value={this.state.demo.black_name} onChange={this.update_demo_black_name}/>
                                        </div>
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="control-label" htmlFor="demo-black-name">{_("Rank")}</label>
                                    <div className="controls">
                                        <div className="checkbox">
                                            <select value={this.state.demo.black_ranking} onChange={this.update_demo_black_ranking} className="challenge-dropdown form-control">
                                                {demo_ranks.map((r, idx) => (
                                                    <option key={idx} value={r.rank}>{r.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="right-pane pane form-horizontal">
                                <div className="form-group">
                                    <label className="control-label" htmlFor="demo-black-name">{_("White Player")}</label>
                                    <div className="controls">
                                        <div className="checkbox">
                                            <input type="text" className="form-control" value={this.state.demo.white_name} onChange={this.update_demo_white_name}/>
                                        </div>
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="control-label" htmlFor="demo-black-name">{_("Rank")}</label>
                                    <div className="controls">
                                        <div className="checkbox">
                                            <select value={this.state.demo.white_ranking} onChange={this.update_demo_white_ranking} className="challenge-dropdown form-control">
                                                {demo_ranks.map((r, idx) => (
                                                    <option key={idx} value={r.rank}>{r.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    }
                    {/* }}} */}
                </div>
              </div>
              <div className="buttons">
                  <button onClick={this.close}>{_("Close")}</button>
                  {(mode === "demo" || null) && <button onClick={this.createDemo} className="primary">{_("Create Demo")}</button>}
                  {(mode === "computer" || null) && <button onClick={this.createChallenge} className="primary">{_("Play")}</button>}
                  {(mode === "player" || null) && <button onClick={this.createChallenge} className="primary">{_("Send Challenge")}</button>}
                  {(mode === "open" || null) && <button onClick={this.createChallenge} className="primary">{_("Create Challenge")}</button>}
              </div>
          </div>
        );
    }
}


//const challenge_open = (<ChallengeModal mode='open'/>);

export function challenge(player_id?: number, initial_state?: any, computer?: boolean, config?: any) {{{
    // TODO: Support challenge by player, w/ initial state, or computer

    if (player_id && typeof(player_id) !== "number") {
        console.log("Invalid player id: ", player_id);
        throw Error("Invalid player id");
    }

    let mode: ChallengeModes = "open";
    if (player_id) {
        mode = "player";
    }
    if (computer) {
        mode = "computer";
    }

    return openModal(<ChallengeModal playerId={player_id} initialState={initial_state} config={config} mode={mode} />);
}}}
export function createDemoBoard() {{{
    let mode: ChallengeModes = "demo";
    return openModal(<ChallengeModal mode={mode} />);
}}}
export function createOpenChallenge() {{{
    return challenge();
}}}
export function challengeComputer() {{{
    return challenge(null, null, true);
}}}
export function challengeFromBoardPosition(goban) {{{
    if (!goban) { return; }

    openForkModal(goban);

    /*
    var game_name = goban.engine.game_name;
    if ((!game_name || game_name === "") && goban.engine.players) {
        game_name = goban.engine.players.black.username +" " + _("vs.") + " " +  goban.engine.players.white.username;
    }

    var state = {
        "moves": goban.engine.cur_move.getMoveStringToThisPoint(),
        "initial_state": goban.engine.initial_state,
        "initial_player": goban.engine.initial_player,
        "width": goban.engine.width,
        "height": goban.engine.height,
        "rules": goban.engine.rules,
        "handicap": goban.engine.handicap,
        "move_number": goban.engine.getMoveNumber(),
        "game_name": game_name,
    };

    challenge(null, state);
    */
}}}
export function challengeRematch(goban, player, original_game_meta) { /* {{{ */
    /* TODO: Fix up challengeRematch time control stuff */
    let conf = goban.engine;
    let config: any = {
        conf: {},
        challenge: {
            game: {}
        }
    };

    console.log(original_game_meta);


    config.conf.handicap_enabled = conf.handicap ? true : false;
    config.challenge.game.handicap = conf.handicap;

    config.time_control = dup(conf.time_control);

    //config.time_control = recallTimeControlSettings('live'); /* speed doesn't matter, we're just getting the obj */
    /*
    config.challenge.game.time_control_parameters = {}

    for (var k in conf.time_control) {
        console.log(k, conf.time_control[k]);
        config.challenge.game.time_control_parameters = Object.assign({}, conf.time_control);
    }
    var tc = conf.time_control;
    config.time_control.time_control = tc.time_control;
    console.log("Conf: ", tc);
    switch (tc.time_control) {
        case 'fischer':
            config.time_control.initial_time = tc.initial_time;
            config.time_control.time_increment = tc.time_increment;
            config.time_control.max_time = tc.max_time;
            break;
        case 'byoyomi':
            config.time_control.main_time = tc.main_time;
            config.time_control.period_time = tc.period_time;
            config.time_control.periods = tc.periods;
            break;
        case 'simple':
            config.time_control.per_move = tc.per_move;
            break;
        case 'canadian':
            config.time_control.main_time = tc.main_time;
            config.time_control.period_time = tc.period_time;
            config.time_control.stones_per_period = tc.stones_per_period;
            break;
        case 'absolute':
            config.time_control.total_time = tc.total_time;
            break;
        case 'none':
            break;
    }
    var avg_move_time = computeAverageMoveTime(tc);


    if (avg_move_time > 0 && avg_move_time < 20) {
        config.conf.speed = 'blitz';
    } else if (avg_move_time > 0 && avg_move_time < 3600) {
        config.conf.speed = 'live';
    } else {
        config.conf.speed = 'correspondence';
    }

   */


    config.challenge.game.time_control = conf.time_control["time_control"];

    config.challenge.game.challenger_color = conf.players.black.id === player.id ? "white" : "black";
    config.challenge.game.rules = conf.rules;
    config.challenge.game.ranked = conf.ranked;
    config.challenge.game.width = conf.width;
    config.challenge.game.height = conf.height;
    config.conf.selected_board_size = goban.width + "x" + goban.height;

    config.challenge.game.komi_auto = "custom";
    config.challenge.game.komi = conf.komi;
    config.challenge.game.disable_analysis = conf.disable_analysis;
    config.challenge.game.pause_on_weekends = false;
    if (original_game_meta && original_game_meta.pause_on_weekends) {
    console.log("orgs", original_game_meta);
        config.challenge.game.pause_on_weekends = true;
    }
    config.challenge.game.initial_state = null;
    config.challenge.game["private"] = conf["private"];

    //config.syncBoardSize();
    //config.syncTimeControl();

    challenge(player.id, null, false, config);
} /* }}} */
export function createBlitz() {{{
    let user = data.get("user");
    let config = dup(blitz_config);
    config.challenge.min_ranking = user.ranking - 3;
    config.challenge.max_ranking = user.ranking + 3;
    config.challenge.game.width = preferences.get("new-game-board-size");
    config.challenge.game.height = preferences.get("new-game-board-size");
    return openModal(<ChallengeModal config={config} mode={"open"} autoCreate={true} />);
}}}
export function createLive() {{{
    let user = data.get("user");
    let config = dup(live_config);
    config.challenge.min_ranking = user.ranking - 3;
    config.challenge.max_ranking = user.ranking + 3;
    config.challenge.game.width = preferences.get("new-game-board-size");
    config.challenge.game.height = preferences.get("new-game-board-size");
    return openModal(<ChallengeModal config={config} mode={"open"} autoCreate={true} />);
}}}
export function createCorrespondence() {{{
    let user = data.get("user");
    let config = dup(correspondence_config);
    config.challenge.min_ranking = user.ranking - 3;
    config.challenge.max_ranking = user.ranking + 3;
    config.challenge.game.width = preferences.get("new-game-board-size");
    config.challenge.game.height = preferences.get("new-game-board-size");
    return openModal(<ChallengeModal config={config} mode={"open"} autoCreate={true} />);
}}}


export function challenge_text_description(challenge) { /* {{{ */
    //console.log(challenge);
    let c = challenge;
    let g = "game" in challenge ? challenge.game : challenge;
    let details_html =
        (g.ranked ? _("Ranked") : _("Unranked"))
        + ", " + g.width + "x" + g.height
        + ", " + interpolate(_("%s rules"), [rulesText(g.rules)]) ;
    //console.log(g.time_control);
    if (g.time_control && g.time_control !== "none") {
        details_html += ", " + interpolate(_("%s clock: %s"), [
            timeControlText(g.time_control),
            shortShortTimeControl(g.time_control)
        ]);
    } else {
        details_html += ", " + _("no time limits");
    }
    details_html +=
        ", " + interpolate(_("%s handicap"), [(g.handicap < 0 ? _("auto") : g.handicap)])
        + ((g.komi == null || typeof(g.komi) === "object") ? "" : (", " + interpolate(_("{{komi}} komi"), {komi: g.komi})))
        + (g.disable_analysis ? ", " + _("analysis disabled") : "")
        ;
    if (c.challenger_color !== "automatic") {
        let yourcolor = "";
        if (data.get("user") &&
            (
                (c.challenger && c.challenger.id !== data.get("user").id) ||
                (c.user && c.user.id !== data.get("user").id)
            )
        ) {
            if (c.challenger_color === "black") {
                yourcolor = _("white");
            }
            else if (c.challenger_color === "white") {
                yourcolor = _("black");
            }
            else {
                yourcolor = _(c.challenger_color);
            }
        } else {
            yourcolor = _(c.challenger_color);
        }

        details_html += ", " + interpolate(pgettext("color", "you play as %s"), [yourcolor]);
    }

    return details_html;
} /* }}} */

export let blitz_config = { /* {{{ */
    conf: {
        handicap_enabled: false,
        restrict_rank: true,
    },
    challenge: {
        challenger_color: "automatic",
        game: {
            name: "",
            rules: "japanese",
            ranked: true,
            handicap: -1,
            komi_auto: "automatic",
            disable_analysis: false,
            initial_state: null,
            "private": false,
        },
    },
    time_control: {
        system: "fischer",
        speed: "blitz",
        initial_time      : 20,
        time_increment    : 10,
        max_time          : 30,
        pause_on_weekends: false,
    }
}; /* }}} */
export let live_config = { /* {{{ */
    conf: {
        handicap_enabled: false,
        restrict_rank: true,
    },
    challenge: {
        challenger_color: "automatic",
        game: {
            name: "",
            rules: "japanese",
            ranked: true,
            handicap: -1,
            komi_auto: "automatic",
            disable_analysis: false,
            initial_state: null,
            "private": false,
        },
    },
    time_control: {
        system: "byoyomi",
        speed: "live",
        main_time: 10 * 60,
        period_time: 30,
        periods: 5,
        pause_on_weekends: false,
    }
}; /* }}} */
export let correspondence_config = { /* {{{ */
    conf: {
        handicap_enabled: false,
        restrict_rank: true,
    },
    challenge: {
        challenger_color: "automatic",
        game: {
            name: "",
            rules: "japanese",
            ranked: true,
            handicap: -1,
            komi_auto: "automatic",
            disable_analysis: false,
            initial_state: null,
            "private": false,
        },
    },
    time_control: {
        system: "fischer",
        speed: "correspondence",
        initial_time      : 3 * 86400,
        time_increment    : 86400,
        max_time          : 7 * 86400,
        pause_on_weekends : true,
    }
}; /* }}} */
